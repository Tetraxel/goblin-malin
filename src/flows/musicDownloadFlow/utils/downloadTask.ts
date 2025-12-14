import { Task } from "../../../base/task/task";
import { StandardTrack } from "./types";


export type DownloadTaskAttributes = {
    track?: StandardTrack;
}

export class DownloadTask extends Task<DownloadTaskAttributes> { }
