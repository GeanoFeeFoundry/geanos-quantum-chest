function isEnderChest(actor) {
    return actor?.getFlag('geanos-ender-chest', 'isEnderChest');
}

function isPrimaryGM() {
    return game.user.isGM && game.users.activeGM?.isSelf;
}

Hooks.once('init', async function() {
    console.log("Geano's Ender Chest | Initializing module");
});

Hooks.once('ready', async function() {
    console.log("Geano's Ender Chest | Ready");

    if (!isPrimaryGM()) return;

    const pack = game.packs.get('geanos-ender-chest.ender-chest-items');
    if (!pack) return;

    const compendiumItems = await pack.getDocuments();
    const itemData = compendiumItems.map(i => {
        const data = i.toObject();
        delete data._id; // Ensure clean IDs when creating on actors
        return data;
    });

    // Find all Ender Chest actors in the world
    const enderChests = game.actors.filter(a => isEnderChest(a));

    for (const actor of enderChests) {
        if (typeof ItemPiles !== 'undefined') {
            await ItemPiles.API.setActorItems(actor, itemData);
        } else {
            // Fallback: manual replace
            const existingIds = actor.items.map(i => i.id);
            if (existingIds.length > 0) {
                await actor.deleteEmbeddedDocuments("Item", existingIds, { noHook: true });
            }
            if (itemData.length > 0) {
                await actor.createEmbeddedDocuments("Item", itemData, { keepId: true, noHook: true, renderSheet: false });
            }
        }
    }
});

// Outbound Sync: World -> Compendium
async function syncToCompendium(actor) {
    if (!isPrimaryGM() || !isEnderChest(actor)) return;
    
    const pack = game.packs.get('geanos-ender-chest.ender-chest-items');
    if (!pack) return;

    const items = actor.items.map(i => {
        const data = i.toObject();
        delete data._id;
        return data;
    });
    
    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });

    const index = await pack.getIndex();
    const existingIds = index.map(i => i._id);
    if (existingIds.length > 0) {
        await Item.deleteDocuments(existingIds, { pack: pack.collection, noHook: true });
    }

    if (items.length > 0) {
        await Item.createDocuments(items, { pack: pack.collection, keepId: true, noHook: true, renderSheet: false });
    }

    if (wasLocked) await pack.configure({ locked: true });
}

// Debounce the sync to avoid spamming the compendium on bulk operations
const debouncedSync = foundry.utils.debounce(syncToCompendium, 1000);

Hooks.on('createItem', (item) => debouncedSync(item.parent));
Hooks.on('updateItem', (item) => debouncedSync(item.parent));
Hooks.on('deleteItem', (item) => debouncedSync(item.parent));

// Actor Sheet UI Toggle
Hooks.on('getActorSheetHeaderButtons', (sheet, buttons) => {
    const actor = sheet.actor;
    
    // Only GM should be able to toggle the Ender Chest flag
    if (!game.user.isGM) return;

    const isChest = isEnderChest(actor);

    buttons.unshift({
        label: game.i18n.localize(isChest ? "GEANOS_ENDER_CHEST.DisableEnderChest" : "GEANOS_ENDER_CHEST.EnableEnderChest"),
        class: "geanos-ender-chest-toggle",
        icon: "fas fa-archive",
        onclick: async () => {
            const newState = !isChest;
            await actor.setFlag('geanos-ender-chest', 'isEnderChest', newState);
            ui.notifications.info(`Ender Chest mode ${newState ? 'enabled' : 'disabled'} for ${actor.name}`);
            
            // Toggle glow dynamically
            if (sheet.element) {
                if (newState) {
                    sheet.element.addClass('geanos-ender-chest-sheet');
                } else {
                    sheet.element.removeClass('geanos-ender-chest-sheet');
                }
            }

            // Trigger an initial sync if it was just enabled
            if (newState) {
                debouncedSync(actor);
            }
        }
    });
});

// Add visual indicator to Actor Directory
Hooks.on('renderActorDirectory', (app, html, data) => {
    const actors = game.actors.filter(a => isEnderChest(a));
    for (const actor of actors) {
        const li = html.find(`.directory-item[data-document-id="${actor.id}"] .document-name`);
        if (li.length > 0) {
            li.append(`<i class="fas fa-archive geanos-ender-chest-directory-icon" title="${game.i18n.localize('GEANOS_ENDER_CHEST.IndicatorTooltip')}"></i>`);
        }
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
