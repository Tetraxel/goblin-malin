/**
 * A small JSON Schema validator for the agent tools' inputs.
 *
 * The tools declare their input as plain JSON Schema (that is what the MCP `tools/list` answer carries, and what
 * the model reads). Everything the model sends is untrusted, so every call is checked against that same schema
 * before a tool runs. Only the subset the tools use is supported: `type` (object, array, string, number, integer,
 * boolean, null), `properties`, `required`, `additionalProperties: false`, `items`, `enum`, `minLength`,
 * `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`. Anything else in a schema is ignored, not trusted:
 * a tool that needs more validates in its own `run`.
 */

export type JsonSchema = {
    type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
    description?: string;
    properties?: Record<string, JsonSchema>;
    required?: readonly string[];
    additionalProperties?: boolean;
    items?: JsonSchema;
    enum?: readonly (string | number | boolean | null)[];
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
};

/** Returns the problems found, as readable lines with the path they are at; empty when the value is valid. */
export function validateJsonSchema(schema: JsonSchema, value: unknown, path = "input"): string[] {
    const errors: string[] = [];
    check(schema, value, path, errors);
    return errors;
}

function typeOf(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
}

function check(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
    if (schema.enum && !schema.enum.includes(value as string | number | boolean | null)) {
        errors.push(`${path} must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`);
        return;
    }

    switch (schema.type) {
        case undefined:
            return;
        case "object": {
            if (typeOf(value) !== "object") return void errors.push(`${path} must be an object`);
            const obj = value as Record<string, unknown>;
            for (const key of schema.required ?? []) {
                if (!Object.hasOwn(obj, key) || obj[key] === undefined) errors.push(`${path}.${key} is required`);
            }
            const known = schema.properties ?? {};
            for (const [key, sub] of Object.entries(known)) {
                if (Object.hasOwn(obj, key) && obj[key] !== undefined) check(sub, obj[key], `${path}.${key}`, errors);
            }
            if (schema.additionalProperties === false) {
                for (const key of Object.keys(obj)) {
                    if (!Object.hasOwn(known, key)) errors.push(`${path}.${key} is not an accepted field`);
                }
            }
            return;
        }
        case "array": {
            if (!Array.isArray(value)) return void errors.push(`${path} must be an array`);
            if (schema.minItems !== undefined && value.length < schema.minItems) {
                errors.push(`${path} must have at least ${schema.minItems} item(s)`);
            }
            if (schema.maxItems !== undefined && value.length > schema.maxItems) {
                errors.push(`${path} must have at most ${schema.maxItems} item(s)`);
            }
            if (schema.items) value.forEach((item, i) => check(schema.items!, item, `${path}[${i}]`, errors));
            return;
        }
        case "string": {
            if (typeof value !== "string") return void errors.push(`${path} must be a string`);
            if (schema.minLength !== undefined && value.length < schema.minLength) {
                errors.push(`${path} must be at least ${schema.minLength} character(s)`);
            }
            if (schema.maxLength !== undefined && value.length > schema.maxLength) {
                errors.push(`${path} must be at most ${schema.maxLength} character(s)`);
            }
            return;
        }
        case "number":
        case "integer": {
            if (typeof value !== "number" || !Number.isFinite(value)) {
                return void errors.push(`${path} must be a number`);
            }
            if (schema.type === "integer" && !Number.isInteger(value)) {
                return void errors.push(`${path} must be an integer`);
            }
            if (schema.minimum !== undefined && value < schema.minimum) {
                errors.push(`${path} must be at least ${schema.minimum}`);
            }
            if (schema.maximum !== undefined && value > schema.maximum) {
                errors.push(`${path} must be at most ${schema.maximum}`);
            }
            return;
        }
        case "boolean":
            if (typeof value !== "boolean") errors.push(`${path} must be true or false`);
            return;
        case "null":
            if (value !== null) errors.push(`${path} must be null`);
            return;
    }
}
