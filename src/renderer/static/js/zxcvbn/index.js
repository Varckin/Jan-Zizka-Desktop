import { ZxcvbnFactory } from './core.js';
import * as common from './language-common.js';
import * as en from './language-en.js';
import * as ru from './language-ru.js';

const instance = new ZxcvbnFactory({
    dictionary: {
        ...common.dictionary,
        ...en.dictionary,
        ...ru.dictionary,
    },
    graphs: common.adjacencyGraphs,
});

export function passphraseScore(value) {
    if (!value) return 0;
    try {
        return instance.check(value).score;
    } catch {
        return 0;
    }
}