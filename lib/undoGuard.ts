// Desfazer só vale se o estado atual ainda é o que a própria ação deixou; senão alguém mexeu depois.
export const canUndo = (expected: string, current: string): boolean => expected === current;
