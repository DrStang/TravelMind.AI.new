export type TodoStatus = "PENDING"|"DONE"|"SKIPPED";
export type Todo = { id: string; title: string; status: TodoStatus; kind?: string|null };
