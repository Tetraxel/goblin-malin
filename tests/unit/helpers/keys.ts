import type { Key } from "ink";

const noKey: Key = {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
};

/** An Ink `Key` with every flag off except the ones given. */
export const makeKey = (overrides: Partial<Key> = {}): Key => ({ ...noKey, ...overrides });
