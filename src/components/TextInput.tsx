import React, { useEffect } from "react";
import InkTextInput, { type Props } from "ink-text-input";
import { textInputFocus } from "#base/textInputFocus";

/**
 * `ink-text-input` that tells the app when it has the keyboard (see `textInputFocus`) and does not type the
 * letter of a Ctrl+letter shortcut. Use this instead of importing `ink-text-input` directly.
 */
export const TextInput: React.FC<Props> = ({ onChange, ...props }) => {
    const focused = props.focus ?? true;
    useEffect(() => (focused ? textInputFocus.acquire() : undefined), [focused]);
    return (
        <InkTextInput
            {...props}
            onChange={(value) => {
                if (!textInputFocus.isControlKeyPress()) onChange(value);
            }}
        />
    );
};
