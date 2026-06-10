function isEnderChest(doc) {
    return doc?.getFlag('geanos-ender-chest', 'isEnderChest');
}

function isPrimaryGM() {
    return game.user.isGM && game.users.activeGM?.isSelf;
}

// Foundry V12 stores the compendium source in _stats.compendiumSource.
// V11 and earlier used flags.core.sourceId. We check both for compatibility.
function getSourceId(doc) {
    return doc._stats?.compendiumSource ?? doc.flags.core?.sourceId ?? null;
}

Hooks.once('init', function() {});

// Inbound Sync: Compendium -> World (on every world load)
Hooks.once('ready', async function() {
    if (!isPrimaryGM()) return;

    for (const collection of [game.actors, game.journal]) {
        for (const doc of collection.filter(d => isEnderChest(d))) {
            await syncFromCompendium(doc);
        }
    }
});

async function syncFromCompendium(doc) {
    const sourceId = getSourceId(doc);
    if (!sourceId || !sourceId.startsWith("Compendium.")) {
        console.warn(`Geano's Ender Chest | '${doc.name}' is flagged but has no compendium sourceId. Skipping inbound sync.`);
        return;
    }

    let compendiumDoc;
    try {
        compendiumDoc = await fromUuid(sourceId);
    } catch (e) {
        console.error(`Geano's Ender Chest | Failed to resolve sourceId '${sourceId}' for '${doc.name}':`, e);
    }

    if (!compendiumDoc) {
        console.warn(`Geano's Ender Chest | Compendium document not found for '${doc.name}'. Is the source compendium module active?`);
        return;
    }

    const masterData = compendiumDoc.toObject();

    if (doc.documentName === "Actor") {
        const existingIds = doc.items.map(i => i.id);
        if (existingIds.length > 0) {
            await doc.deleteEmbeddedDocuments("Item", existingIds, { noHook: true });
        }
        if (masterData.items.length > 0) {
            const itemData = masterData.items.map(i => {
                const data = foundry.utils.deepClone(i);
                delete data._id;
                return data;
            });
            await doc.createEmbeddedDocuments("Item", itemData, { keepId: false, noHook: true, renderSheet: false });
        }
        await doc.update({ system: masterData.system }, { noHook: true });

    } else if (doc.documentName === "JournalEntry") {
        // Pages are embedded documents - treat them the same way as actor items
        const existingPageIds = doc.pages.map(p => p.id);
        if (existingPageIds.length > 0) {
            await doc.deleteEmbeddedDocuments("JournalEntryPage", existingPageIds, { noHook: true });
        }
        if (masterData.pages.length > 0) {
            const pageData = masterData.pages.map(p => {
                const data = foundry.utils.deepClone(p);
                delete data._id;
                return data;
            });
            await doc.createEmbeddedDocuments("JournalEntryPage", pageData, { keepId: false, noHook: true, renderSheet: false });
        }
    }
}

// Outbound Sync: World -> Compendium
async function syncToCompendium(doc) {
    if (!isPrimaryGM() || !isEnderChest(doc)) return;

    const sourceId = getSourceId(doc);
    if (!sourceId || !sourceId.startsWith("Compendium.")) return;

    let compendiumDoc;
    try {
        compendiumDoc = await fromUuid(sourceId);
    } catch (e) {
        console.error(`Geano's Ender Chest | Failed to resolve sourceId '${sourceId}':`, e);
        return;
    }
    if (!compendiumDoc) return;

    // Parse pack key from UUID: "Compendium.packageId.packName.DocType.id" -> "packageId.packName"
    // NOTE: .collection on a resolved V12 compendium document returns a Map, not a string.
    const packKey = sourceId.split(".").slice(1, 3).join(".");
    const pack = game.packs.get(packKey);
    if (!pack) return;

    const DocumentClass = CONFIG[doc.documentName]?.documentClass;
    if (!DocumentClass) return;

    const localData = doc.toObject();

    // Preserve compendium-specific identity fields, sync everything else
    localData._id = compendiumDoc.id;
    localData.name = compendiumDoc.name;
    localData.ownership = compendiumDoc.ownership;
    localData.folder = compendiumDoc.folder;
    localData.sort = compendiumDoc.sort;
    if (doc.documentName === "Actor") {
        localData.prototypeToken = compendiumDoc.prototypeToken;
    }

    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({ locked: false });

    // Replace the compendium entry wholesale to avoid deep-merge artifacts
    await DocumentClass.deleteDocuments([compendiumDoc.id], { pack: pack.collection, noHook: true });
    await DocumentClass.createDocuments([localData], { pack: pack.collection, keepId: true, noHook: true, renderSheet: false });

    if (wasLocked) await pack.configure({ locked: true });
}

// Debounce the sync to avoid spamming the compendium on bulk operations
const debouncedSync = foundry.utils.debounce(syncToCompendium, 1000);

// Actor hooks: embedded item changes bubble up to the parent actor
Hooks.on('createItem', (item, _data, options) => {
    if (options?.noHook || !item.parent || !isEnderChest(item.parent)) return;
    debouncedSync(item.parent);
});
Hooks.on('updateItem', (item, _changes, options) => {
    if (options?.noHook || !item.parent || !isEnderChest(item.parent)) return;
    debouncedSync(item.parent);
});
Hooks.on('deleteItem', (item, options) => {
    if (options?.noHook || !item.parent || !isEnderChest(item.parent)) return;
    debouncedSync(item.parent);
});
Hooks.on('updateActor', (doc, changes, options) => {
    if (foundry.utils.hasProperty(changes, "flags.geanos-ender-chest.isEnderChest")) {
        ui.actors?.render();
    }
    if (isEnderChest(doc) && !options?.noHook) debouncedSync(doc);
});

// Journal hooks: page changes bubble up to the parent journal entry
Hooks.on('createJournalEntryPage', (page, _data, options) => {
    if (options?.noHook || !isEnderChest(page.parent)) return;
    debouncedSync(page.parent);
});
Hooks.on('updateJournalEntryPage', (page, _changes, options) => {
    if (options?.noHook || !isEnderChest(page.parent)) return;
    debouncedSync(page.parent);
});
Hooks.on('deleteJournalEntryPage', (page, options) => {
    if (options?.noHook || !isEnderChest(page.parent)) return;
    debouncedSync(page.parent);
});
Hooks.on('updateJournalEntry', (doc, _changes, options) => {
    if (isEnderChest(doc) && !options?.noHook) debouncedSync(doc);
});

// Header button toggle - restricted to supported document types
function insertHeaderButton(app, buttons) {
    const doc = app.document ?? app.actor ?? app.object;
    if (!doc?.getFlag || !game.user.isGM) return;
    if (doc.documentName !== "Actor" && doc.documentName !== "JournalEntry") return;

    const isChest = isEnderChest(doc);
    buttons.unshift({
        label: game.i18n.localize(isChest ? "GEANOS_ENDER_CHEST.DisableEnderChest" : "GEANOS_ENDER_CHEST.EnableEnderChest"),
        class: "geanos-ender-chest-toggle",
        icon: "fas fa-archive",
        onclick: async () => {
            const newState = !isChest;
            await doc.setFlag('geanos-ender-chest', 'isEnderChest', newState);
            ui.notifications.info(`Ender Chest mode ${newState ? 'enabled' : 'disabled'} for ${doc.name}`);
            if (app.element) app.element.toggleClass('geanos-ender-chest-sheet', newState);
            if (newState) debouncedSync(doc);
        }
    });
}

Hooks.on('getActorSheetHeaderButtons',   insertHeaderButton);
Hooks.on('getJournalSheetHeaderButtons', insertHeaderButton);
Hooks.on('getApplicationHeaderButtons',  insertHeaderButton);

// Visual indicator in sidebar directories
function addDirectoryIndicators(html, collection) {
    const tooltip = game.i18n.localize('GEANOS_ENDER_CHEST.IndicatorTooltip');
    const iconHTML = `<i class="fas fa-archive geanos-ender-chest-directory-icon" title="${tooltip}" style="margin-left: 5px; color: #a020f0;"></i>`;
    for (const doc of collection.filter(d => isEnderChest(d))) {
        const li = html.find(`[data-document-id="${doc.id}"]`);
        if (li.length === 0) continue;
        const nameEl = li.find('.document-name');
        (nameEl.length > 0 ? nameEl : li).append(iconHTML);
    }
}

Hooks.on('renderActorDirectory',   (app, html) => addDirectoryIndicators(html, game.actors));
Hooks.on('renderJournalDirectory', (app, html) => addDirectoryIndicators(html, game.journal));

// Glow on open sheets
Hooks.on('renderActorSheet',   (app, html) => html.closest('.app').toggleClass('geanos-ender-chest-sheet', !!isEnderChest(app.actor)));
Hooks.on('renderJournalSheet', (app, html) => html.closest('.app').toggleClass('geanos-ender-chest-sheet', !!isEnderChest(app.object)));
