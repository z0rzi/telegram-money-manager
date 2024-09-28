export default function env(varName: string, expectedType?: 'string'): string;
export default function env(varName: string, expectedType: 'number'): number;
export default function env(
    varName: string,
    expectedType?: 'number' | 'string'
): number | string {
    const value = process.env[varName];
    if (value == null) throw new Error(`Could not find env var '${varName}'`);

    if (expectedType === 'number') {
        const numValue = Number(value);
        if (isNaN(numValue))
            throw new Error(
                `Expected '${varName}' to be a number, but it's not: '${value}'`
            );
        return numValue;
    }
    return value;
}
