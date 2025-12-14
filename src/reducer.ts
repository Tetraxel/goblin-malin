import { Task } from "./base/task/task";

export enum ItemsActionType {
    SET_TASKS = 'SET_TASKS',
    UPDATE_TASK = 'UPDATE_TASK',
}

// Action types
type TasksReducerAction =
    | { type: ItemsActionType.SET_TASKS; payload: Task[] }
    | { type: ItemsActionType.UPDATE_TASK; payload: { id: string; updates: Partial<Task> } };

// Reducer
export function tasksReducer(state: Task[], action: TasksReducerAction): Task[] {
    switch (action.type) {
        case ItemsActionType.SET_TASKS:
            return action.payload;
        // case ItemsActionType.UPDATE_TASK:
        //     return state.map(item =>
        //         item.id === action.payload.id
        //             ? { ...item, ...action.payload.updates }
        //             : item
        //     );
        default:
            return state;
    }
}
