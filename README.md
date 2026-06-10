# Geano's Ender Chest

**Geano's Ender Chest** is a Foundry VTT module that seamlessly synchronizes the inventory of specific actors across multiple worlds. By utilizing a shared compendium as a persistent "Ender Chest", you can easily share items, equipment, and loot between different campaigns or server instances.

## ✨ Features

### 📦 Cross-World Synchronization
*   **Shared Compendium**: Uses a central `ender-chest-items` compendium to store all synced data across your Foundry server.
*   **Actor & Journal Support**: Synchronizes the inventories of marked Actors and pages of marked Journal Entries.
*   **Automatic Sync**: Any items you create, update, or delete are instantly pushed to the compendium. Worlds pull updates automatically upon load.
*   **GM Authority**: To prevent race conditions, only the active primary GM handles the synchronization silently in the background.

### 🎨 Visual Indicators
*   **Sheet Glow**: Actors and Journals marked as Ender Chests receive a distinct purple glow around their window.
*   **Directory Icons**: A purple archive icon appears next to synced documents in your sidebar directories for quick identification.

## 🚀 Installation

- **Manifest URL**: `https://github.com/GeanoFeeFoundry/geanos-ender-chest/releases/latest/download/module.json` within Foundry's "Install Module" window.

## 🎮 Usage

1.  Navigate to the **Actors Directory** or **Journal Directory**.
2.  Open the Actor or Journal Entry you want to use as a shared chest.
3.  Click the **"Enable Ender Chest"** button in the window header.
4.  The sheet will gain a purple glow. Any items (or pages) you add, edit, or remove will now sync instantly.
5.  Load into a different world on the same server, enable the module, and the marked documents will automatically retrieve their updated contents.

## 🔧 Technical Details

*   **Data Pipeline**: Captures standard document hooks (`createItem`, `updateItem`, `deleteItem`, `createJournalEntryPage`, etc.) and pipes changes to the shared LevelDB compendium.
*   **Inbound Sync**: On the `ready` hook, the GM's client checks all local Ender Chest actors and replaces their inventory array with the master list from the compendium to ensure 100% parity.
*   **Item Piles Integration**: Works perfectly alongside Item Piles. Simply configure the Actor as a merchant or chest and enable the Ender Chest toggle.

---
## License
This module is licensed under the [MIT License](LICENSE).
