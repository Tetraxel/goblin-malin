import * as path from 'path';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import { PROJECT_ROOT } from '../constants';
import { Task } from '../base/task/task';
import { globalLogger } from '../base/logger/logger';

interface TrackInput {
  trackUrl: string;
  artistName?: string;
  trackTitle?: string;
}

export class InputLoader {
  private static instance: InputLoader;

  private constructor() { }

  static getInstance(): InputLoader {
    if (!InputLoader.instance) {
      InputLoader.instance = new InputLoader();
    }
    return InputLoader.instance;
  }

  // Load URLs from inputs.txt and convert to DownloadItems
  async loadFromFile(filepath: string = 'inputs.txt'): Promise<Task[]> {
    try {
      const content = await fs.readFile(filepath, 'utf-8');
      const urls = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#')); // Filter empty lines and comments

      const tasks: Task[] = urls.map((url, index) => new Task({ id: `item-${index}`, initialInput: url }));

      globalLogger.info(`Loaded ${tasks.length} items from ${filepath}`);
      return tasks;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        globalLogger.error(`File not found: ${filepath}`);
        throw new Error(`Input file '${filepath}' does not exist`);
      }

      globalLogger.error(`Failed to read ${filepath}`, { error });
      throw error;
    }
  }

  // Validate if a string is a valid URL
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  // Load and validate URLs
  async loadAndValidate(filepath: string = 'inputs.txt'): Promise<{
    valid: Task[];
    invalid: string[];
  }> {
    const items = await this.loadFromFile(filepath);
    const valid: Task[] = [];
    const invalid: string[] = [];

    items.forEach(item => {
      const initialInput = item.getInitialInput() ?? ""
      if (this.isValidUrl(initialInput)) {
        valid.push(item);
      } else {
        invalid.push(initialInput);
        globalLogger.warn(`Invalid URL skipped: ${initialInput}`);
      }
    });

    return { valid, invalid };
  }


  public parseTrackInput(line: string): TrackInput | null {
    const trimmedLine = line.trim();

    // Skip empty lines
    if (trimmedLine.length === 0) {
      return null;
    }

    let trackUrl: string;
    let artistName: string | undefined = undefined;
    let trackTitle: string | undefined = undefined;

    // Find the first space, which separates the URL from the rest
    const firstSpaceIndex = trimmedLine.indexOf(' ');

    if (firstSpaceIndex === -1) {
      // No space found, the entire line is the URL
      trackUrl = trimmedLine;
    } else {
      // URL is the part before the first space
      trackUrl = trimmedLine.substring(0, firstSpaceIndex);

      // The rest of the string *might* contain artist and title
      const rest = trimmedLine.substring(firstSpaceIndex + 1).trim();

      if (rest.length >= 0) {
        // Check for the " - " separator
        const separator = ' - ';
        const separatorIndex = rest.indexOf(separator);

        if (separatorIndex === -1) {
          artistName = rest
        } else {
          // Separator found, extract artist and title
          artistName = rest.substring(0, separatorIndex).trim()
          trackTitle = rest.substring(separatorIndex + separator.length).trim()
        }
      }
    }

    return { trackUrl, artistName, trackTitle }
  }

  /**
   * Reads and parses the track input file.
   * @param {string} filename - The name of the local file to read (e.g., "inputs.txt").
   * @returns {TrackInput[]} An array of parsed TrackInput objects.
   */
  public parseTrackInputFile(filename: string): TrackInput[] {
    const filePath = path.join(PROJECT_ROOT, filename);

    globalLogger.info(`Reading file from: ${filePath}`);

    let fileContent: string;
    try {
      fileContent = readFileSync(filePath, 'utf-8');
    } catch (error: Error | unknown) {
      globalLogger.error(`Error reading file "${filename}":`, { error });
      throw new Error(`Could not read file: ${filePath}`);
    }

    const lines = fileContent.split('\n');

    return lines
      .map(line => this.parseTrackInput(line))
      .filter((track): track is TrackInput => track !== null);
  }

}

const inputLoader = InputLoader.getInstance();
export default inputLoader;
