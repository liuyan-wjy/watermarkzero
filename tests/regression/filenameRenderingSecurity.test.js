import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModuleSource } from '../testUtils/moduleStructure.js';

function getCreateImageCardBlock(source) {
    const match = String(source).match(/function createImageCard\(item\) \{[\s\S]*?\n\}/);
    assert.ok(match, 'expected createImageCard function to exist');
    return match[0];
}

function createMockCard() {
    const imageName = {
        textContent: '',
        title: ''
    };

    return {
        id: '',
        className: '',
        appended: false,
        innerHTML: '',
        querySelector(selector) {
            if (selector === '.image-name') {
                return imageName;
            }
            return null;
        },
        getImageName() {
            return imageName;
        }
    };
}

test('createImageCard should not interpolate user-controlled filename into innerHTML', () => {
    const appSource = loadModuleSource('../../src/app.js', import.meta.url);
    const createImageCardSource = getCreateImageCardBlock(appSource);

    assert.equal(
        createImageCardSource.includes('${item.name}'),
        false,
        'expected createImageCard to avoid inserting item.name directly into the rendered HTML template'
    );
    assert.equal(
        createImageCardSource.includes("card.querySelector('.image-name')"),
        true,
        'expected createImageCard to query the filename node after DOM creation'
    );
    assert.equal(
        createImageCardSource.includes("const safeImageName = typeof item.name === 'string' ? item.name : '';"),
        true,
        'expected createImageCard to normalize the filename before writing it into the DOM'
    );
    assert.equal(
        createImageCardSource.includes('imageName.textContent = safeImageName;'),
        true,
        'expected createImageCard to assign the filename through textContent after DOM creation'
    );
    assert.equal(
        createImageCardSource.includes('imageName.title = safeImageName;'),
        true,
        'expected createImageCard to keep the full filename accessible via a safe title attribute'
    );
});

test('createImageCard should keep truncated filenames accessible without reintroducing HTML injection', () => {
    const appSource = loadModuleSource('../../src/app.js', import.meta.url);
    const createImageCardSource = getCreateImageCardBlock(appSource);
    const createdCards = [];

    const context = {
        document: {
            createElement() {
                const card = createMockCard();
                createdCards.push(card);
                return card;
            }
        },
        imageList: {
            appendChild(card) {
                card.appended = true;
            }
        },
        i18n: {
            t(key) {
                return key;
            }
        }
    };

    vm.runInNewContext(`${createImageCardSource}; this.createImageCard = createImageCard;`, context);

    const maliciousName = 'report"><img src=x onerror=alert(1)>.png';
    context.createImageCard({
        id: 7,
        name: maliciousName
    });

    assert.equal(createdCards.length, 1, 'expected createImageCard to allocate one card element');

    const card = createdCards[0];
    const imageName = card.getImageName();

    assert.equal(card.appended, true, 'expected created card to be appended to the image list');
    assert.equal(
        card.innerHTML.includes(maliciousName),
        false,
        'expected the user-controlled filename to stay out of the innerHTML template'
    );
    assert.equal(
        imageName.textContent,
        maliciousName,
        'expected the rendered filename to be assigned through textContent'
    );
    assert.equal(
        imageName.title,
        maliciousName,
        'expected the full filename to remain accessible through a safe title attribute'
    );
});
