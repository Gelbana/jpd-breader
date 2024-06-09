// @reader content-script

import { ParseBatch, requestParse } from '../content/background_comms.js';
import { Fragment } from '../content/parse.js';
import { showError } from '../content/toast.js';
import { parseParagraphs, visibleObserver, addedObserver, propertyChangeObserver } from './common.js';

try {
    const pendingBatches = new Map<string, ParseBatch[]>();
    console.log('Mokuro integration loaded');

    const callback = (mutations: MutationRecord[]) => {
        mutations.forEach(mutation => {
            const batches: ParseBatch[] = [];
            if (mutation.type === 'attributes') {
                const panel = document.getElementById('manga-panel') as HTMLElement;
                if (panel === null) {
                    // We are probably on a menu or something
                    return;
                }
                const pageId = panel.firstElementChild!.getAttribute('background-image')!;

                // This should never happen (uuid is randomised) but just in case
                if (pendingBatches.has(pageId)) return;

                // Cancel any pending batches
                // Otherwise we might get the previous page's text on the new page
                // TODO: This doesn't seem to work atm
                for (const [_, pageBatches] of pendingBatches) {
                    for (const batch of pageBatches) {
                        batch.abort.abort();
                    }
                }

                pendingBatches.clear();

                const paragraphs = [...panel.firstElementChild!.children].map(box => {

                    const fragments: Fragment[] = [];
                    let offset = 0;

                    // HACK: Because the app reuses any existsing text nodes when changing pages, we need to remove the jpdb stuff
                    // We duplicate the contents of the box and run jpdb stuff on that.
                    // We need to keep the original nodes so text replacement works correctly but we can hide them.
                    const toEdit = [];
                    const toRemove = [];
                    for (const p of box.children) {
                        if (p.tagName !== 'P') continue;
                        // Reset the styles in case they were hidden
                        p.removeAttribute('style');

                        // If any of the children are jpdb words, we can remove the node
                        if (p.querySelector('.jpdb-word') !== null) {
                            toRemove.push(p);
                            continue;
                        }

                        const clone = p.cloneNode(true) as HTMLElement;
                        toEdit.push(clone);
                        (p as HTMLElement).style.display = 'none';
                    }

                    for (let i = toRemove.length - 1; i >= 0; i--) {
                        toRemove[i].remove();
                    }

                    for (const p of toEdit) {

                        const text = p.firstChild as Text;
                        // If we don't have direct text, we have probably replaced it with the jpdb text
                        text.data = text.data
                            .replaceAll('．．．', '…')
                            .replaceAll('．．', '…')
                            .replaceAll('！！', '‼')
                            .replaceAll('！？', '“⁉');

                        const start = offset;
                        const length = text.length;
                        const end = (offset += length);

                        fragments.push({ node: text, start, end, length, hasRuby: false });
                    }

                    box.append(...toEdit);
                    return fragments;
                });
                if (paragraphs.length === 0) {
                    return;
                }
                const [pageBatches, applied] = parseParagraphs(paragraphs);
                Promise.all(applied)
                    .then(() => {
                        pendingBatches.delete(pageId);
                    });

                pendingBatches.set(pageId, pageBatches);
                batches.push(...pageBatches);
            }

            requestParse(batches);
        });
    };

    const container = document.getElementById('popupAbout')
    if (container === null) {
        throw new Error('No page container found');
    }

    // Set up observer for when the container content changes
    propertyChangeObserver(container, callback);

} catch (error) {
    console.error(error);
    showError(error);
}

