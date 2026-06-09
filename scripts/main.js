function isEnderChest(actor) {
    return actor?.getFlag('geanos-ender-chest', 'isEnderChest');
}

function isPrimaryGM() {
    return game.user.isGM && game.users.activeGM?.isSelf;
}

// Foundry V12 stores the compendium source in _stats.compendiumSource.
// V11 and earlier used flags.core.sourceId. We check both for compatibility.
function getSourceId(actor) {
    return actor._stats?.compendiumSource ?? actor.flags.core?.sourceId ?? null;
}

Hooks.once('init', async function() {
    console.log("Geano's Ender Chest | Initializing module");
});

Hooks.once('ready', async function() {
    console.log("Geano's Ender Chest | Ready");

    if (!isPrimaryGM()) return;

    // Find all Ender Chest actors in the world
    const enderChests = game.actors.filter(a => isEnderChest(a));

    for (const actor of enderChests) {
        const sourceId = getSourceId(actor);
        if (!sourceId || !sourceId.startsWith("Compendium.")) {
            console.warn(`Geano's Ender Chest | Actor ${actor.name} is flagged but has no valid compendium sourceId. Skipping sync.`);
            continue;
        }

        let compendiumActor;
        try {
            compendiumActor = await fromUuid(sourceId);
        } catch (e) {
            console.error(`Geano's Ender Chest | Failed to resolve sourceId ${sourceId} for ${actor.name}`);
        }

        if (!compendiumActor) {
            console.warn(`Geano's Ender Chest | Compendium actor not found for ${actor.name}. Make sure the shared compendium module is active.`);
            continue;
        }

        const masterData = compendiumActor.toObject();

        // Sync Items - manual replace is the most reliable path
        const existingIds = actor.items.map(i => i.id);
        if (existingIds.length > 0) {
            await actor.deleteEmbeddedDocuments("Item", existingIds, { noHook: true });
        }
        if (masterData.items.length > 0) {
            const itemData = masterData.items.map(i => {
                const data = foundry.utils.deepClone(i);
                delete data._id;
                return data;
            });
            await actor.createEmbeddedDocuments("Item", itemData, { keepId: false, noHook: true, renderSheet: false });
        }

        // Sync System Data (currency, stats) - preserve local flags
        await actor.update({ system: masterData.system }, { noHook: true });
    }
});

// Outbound Sync: World -> Compendium
async function syncToCompendium(actor) {
    if (!isPrimaryGM() || !isEnderChest(actor)) return;

    const sourceId = getSourceId(actor);
    if (!sourceId || !sourceId.startsWith("Compendium.")) {
        console.warn(`Geano's Ender Chest | '${actor.name}' has no sourceId. Drag it out of a compendium to enable sync.`);
        return;
    }

    console.log(`Geano's Ender Chest | Syncing '${actor.name}' (sourceId: ${sourceId})...`);

    let compendiumActor;
    try {
        compendiumActor = await fromUuid(sourceId);
    } catch (e) {
        console.error(`Geano's Ender Chest | fromUuid failed for '${sourceId}':`, e);
        return;
    }

    if (!compendiumActor) {
        console.warn(`Geano's Ender Chest | fromUuid returned null for '${sourceId}'. Is the source compendium module active?`);
        return;
    }

    // Parse pack key from UUID string: "Compendium.packageId.packName.Actor.id" -> "packageId.packName"
    // NOTE: .collection on a resolved V12 compendium document returns a Map, not a string.
    const uuidParts = sourceId.split(".");
    const packKey = uuidParts.slice(1, 3).join(".");
    console.log(`Geano's Ender Chest | Resolved compendium pack: '${packKey}'`);

    const pack = game.packs.get(packKey);
    if (!pack) {
        console.error(`Geano's Ender Chest | game.packs.get('${packKey}') returned null. Available packs: ${[...game.packs.keys()].join(", ")}`);
        return;
    }

    const localData = actor.toObject();

    // Preserve compendium-specific identity fields, sync everything else
    localData._id = compendiumActor.id;
    localData.name = compendiumActor.name;
    localData.prototypeToken = compendiumActor.prototypeToken;
    localData.ownership = compendiumActor.ownership;
    localData.folder = compendiumActor.folder;
    localData.sort = compendiumActor.sort;

    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });

    // Replace the compendium entry wholesale to avoid deep-merge artifacts
    await Actor.deleteDocuments([compendiumActor.id], { pack: pack.collection, noHook: true });
    await Actor.createDocuments([localData], { pack: pack.collection, keepId: true, noHook: true, renderSheet: false });

    if (wasLocked) await pack.configure({ locked: true });
    console.log(`Geano's Ender Chest | Sync complete: '${actor.name}' -> '${packKey}'.`);
}


// Debounce the sync to avoid spamming the compendium on bulk operations
const debouncedSync = foundry.utils.debounce(syncToCompendium, 1000);

// Guard safely against missing options object (e.g. from Item Piles or other modules)
Hooks.on('createItem', (item, _data, options) => { if (!options?.noHook && item.parent) debouncedSync(item.parent); });
Hooks.on('updateItem', (item, _changes, options) => { if (!options?.noHook && item.parent) debouncedSync(item.parent); });
Hooks.on('deleteItem', (item, options) => { if (!options?.noHook && item.parent) debouncedSync(item.parent); });

// Actor Sheet UI Toggle (V1 and V2)
function insertHeaderButton(app, buttons) {
    const actor = app.actor || app.document;
    if (!actor || actor.documentName !== "Actor") return;
    
    // Only GM should be able to toggle the Ender Chest flag
    if (!game.user.isGM) return;

    const isChest = isEnderChest(actor);
    const btn = {
        label: game.i18n.localize(isChest ? "GEANOS_ENDER_CHEST.DisableEnderChest" : "GEANOS_ENDER_CHEST.EnableEnderChest"),
        class: "geanos-ender-chest-toggle",
        icon: "fas fa-archive",
        onclick: async () => {
            const newState = !isChest;
            await actor.setFlag('geanos-ender-chest', 'isEnderChest', newState);
            ui.notifications.info(`Ender Chest mode ${newState ? 'enabled' : 'disabled'} for ${actor.name}`);
            
            // Toggle glow dynamically (V1)
            if (app.element) {
                if (newState) {
                    app.element.addClass('geanos-ender-chest-sheet');
                } else {
                    app.element.removeClass('geanos-ender-chest-sheet');
                }
            }

            // Trigger an initial sync if it was just enabled
            if (newState) {
                debouncedSync(actor);
            }
        }
    };

    // V2 Applications might not have unshift or expect different structure, but array methods should work.
    buttons.unshift(btn);
}

Hooks.on('getActorSheetHeaderButtons', insertHeaderButton);
Hooks.on('getApplicationHeaderButtons', insertHeaderButton);

// Add visual indicator to Actor Directory
Hooks.on('renderActorDirectory', (app, html, data) => {
    const actors = game.actors.filter(a => isEnderChest(a));
    for (const actor of actors) {
        const li = html.find(`[data-document-id="${actor.id}"]`);
        if (li.length > 0) {
            const nameEl = li.find('.document-name');
            const iconHTML = `<i class="fas fa-archive geanos-ender-chest-directory-icon" title="${game.i18n.localize('GEANOS_ENDER_CHEST.IndicatorTooltip')}" style="margin-left: 5px; color: #a020f0;"></i>`;
            if (nameEl.length > 0) {
                nameEl.append(iconHTML);
            } else {
                li.append(iconHTML);
            }
        }
    }
});

// Force Sidebar re-render when flag changes
Hooks.on('updateActor', (actor, changes, options) => {
    if (foundry.utils.hasProperty(changes, "flags.geanos-ender-chest.isEnderChest")) {
        ui.actors.render();
    }
    if (isEnderChest(actor) && !options.noHook) {
        debouncedSync(actor);
    }
});

// Add glow to Actor Sheet
Hooks.on('renderActorSheet', (app, html, data) => {
    if (isEnderChest(app.actor)) {
        html.closest('.app').addClass('geanos-ender-chest-sheet');
    } else {
        html.closest('.app').removeClass('geanos-ender-chest-sheet');
    }
});
