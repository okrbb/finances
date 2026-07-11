export function normalizeImportRuleText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

export function parseImportRulesText(value) {
    const lines = String(value || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));

    const rules = [];
    const invalidLines = [];

    lines.forEach((line) => {
        const parts = line.split('=>');
        if (parts.length !== 2) {
            invalidLines.push(line);
            return;
        }

        const pattern = normalizeImportRuleText(parts[0]);
        const category = String(parts[1] || '').trim();
        if (!pattern || !category) {
            invalidLines.push(line);
            return;
        }

        rules.push({ pattern, category });
    });

    return {
        rules,
        invalidLines,
        valid: invalidLines.length === 0
    };
}

export function matchImportRule(fullNote, rules = []) {
    const normalizedNote = normalizeImportRuleText(fullNote);
    const rule = rules.find((candidate) => normalizedNote.includes(candidate.pattern));
    return rule?.category || null;
}