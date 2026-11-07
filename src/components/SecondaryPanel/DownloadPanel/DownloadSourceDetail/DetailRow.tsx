import React from "react";
import { FocusRow, FocusRowProps } from "./FocusRow";

/** A read-only `LABEL  value` row (the cursor never lands on it). */
export function DetailRow(props: Omit<FocusRowProps, "isFocused" | "edit" | "badge">) {
    return <FocusRow {...props} />;
}
