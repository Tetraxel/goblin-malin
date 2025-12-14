import { Logger } from "./logger/logger";
import { Task } from "./task/task";
import { TaskStatus } from "./task/task-status";

export class FlowBase {
    protected logger: Logger;
    protected task: Task;
    protected updateItem: any;
    protected emit: any;
    protected status: TaskStatus;

    constructor(logger: Logger, task: Task) {
        this.logger = logger.createChild({
            // set the flow as the class name that inherits from this class
            flow: this.constructor.name,
            url: task.getInitialInput(),
        });
        this.task = task;
        this.status = this.task.getStatus();
    }

    async start(): Promise<void> {
        throw new Error("Method not implemented.");
    }

}
