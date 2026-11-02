import React from "react";
import { FocusRow } from "./FocusRow";

/** A read-only `LABEL  value` row (the cursor never lands on it). */
export function DetailRow({
    label,
    value,
    valueColor,
    dim,
    variant,
}: {
    label: string;
    value: string;
    valueColor?: string;
    dim?: boolean;
    variant?: "plain" | "attribute";
}) {
    return <FocusRow label={label} value={value} valueColor={valueColor} dim={dim} variant={variant} />;
}
