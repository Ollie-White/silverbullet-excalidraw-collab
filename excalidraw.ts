import {
  asset,
  editor,
  space,
  clientStore,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { SlashCompletions } from "@silverbulletmd/silverbullet/types";

type DiagramType = "Widget" | "Attachment";

type CollaborationConfig = {
  serverUrl: string;
  enabled: boolean;
};

type ExcalidrawFileData = {
  type: "excalidraw";
  version: number;
  roomId?: string;
  roomKey?: string;
  collaborationServer?: string;
  elements?: any[];
  appState?: any;
  files?: any;
};

type props = { height?: string, theme?: string, roomId?: string, roomKey?: string, collaborationServer?: string }

// Get collaboration configuration from client store
async function getCollaborationConfig(): Promise<CollaborationConfig> {
  const serverUrl = await clientStore.get("excalidraw.collaborationServerUrl");
  const enabled = await clientStore.get("excalidraw.collaborationEnabled");
  return {
    serverUrl: serverUrl || "https://excalidraw-room.example.com",
    enabled: enabled !== false, // enabled by default
  };
}

// Create a new collaboration room
async function createCollaborationRoom(serverUrl: string): Promise<{ roomId: string; roomKey: string } | null> {
  try {
    const response = await fetch(`${serverUrl}/api/v2/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      console.error("Failed to create collaboration room:", response.statusText);
      return null;
    }
    
    const data = await response.json();
    return {
      roomId: data.roomId,
      roomKey: data.roomKey,
    };
  } catch (error) {
    console.error("Error creating collaboration room:", error);
    return null;
  }
}

async function getHtmlJs(
  path: string,
  type: "editor" | "widget" | "fullscreen",
  props: props = {}
): Promise<{ html: string; script: string }> {
  const spaceTheme = (await clientStore.get("darkMode")) ? "dark" : "light";
  const theme = props.theme || spaceTheme;
  const js = await asset.readAsset("excalidraw", "assets/editor.js");
  const css = await asset.readAsset("excalidraw", "assets/editor.css");
  
  // Build data attributes
  let dataAttrs = `data-filename="${path}" data-theme="${theme}" data-type="${type}"`;
  if (props.roomId) {
    dataAttrs += ` data-room-id="${props.roomId}"`;
  }
  if (props.roomKey) {
    dataAttrs += ` data-room-key="${props.roomKey}"`;
  }
  if (props.collaborationServer) {
    dataAttrs += ` data-collaboration-server="${props.collaborationServer}"`;
  }

  let html = "";
  switch (type) {
    case "editor": {
      html = `<style>${css}</style><div id="editor" ${dataAttrs}></div>`;
      break;
    }
    case "widget": {
      html = `<style>${css}</style><div id="widget" class="excalidraw-widget" style="height: ${props.height}" ${dataAttrs}></div>`;
      break;
    }
    case "fullscreen": {
      html = `<style>${css}</style><div id="svgeditor" class="excalidraw-fullscreen" ${dataAttrs}></div>`;
      break;
    }
  }

  const script = `
    ${js};
  `;

  return { html: html, script: script };
}

export async function openExcalidrawEditor(): Promise<{ html: string; script: string }> {
  const path = await editor.getCurrentPage();
  return getHtmlJs(path, "editor");
}

export async function openExcalidrawEditorWithFile(
  diagramPath?: string
): Promise<void> {
  const path = diagramPath ?? (await editor.getCurrentPage());
  await editor.navigate(path);
}

export async function openFullScreenEditor(diagramPath: string): Promise<void> {
  const assets = await getHtmlJs(diagramPath, "fullscreen");
  await editor.showPanel(
    "modal",
    1,
    assets.html,
    assets.script
  );
}

function getFileExtension(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index !== -1 ? filename.slice(index + 1) : "";
}

function getDiagrams(text: string): string[] {
  const regex = /\((.*?)\)/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const ext = getFileExtension(match[1]);
    if (ext === "svg" || ext === "png" || ext === "excalidraw") {
      matches.push(match[1]);
    }
  }
  return matches;
}

/* "Excalidraw: Edit diagram" 
 
looks for attached diagrams 
Prompts the user to select one attachment 
Opens the editor
 
*/
export async function editDiagram(): Promise<void> {
  const text = await editor.getText();
  const matches = getDiagrams(text);

  if (await isRoMode()) return;
  let diagramPath = "";
  if (matches.length === 0) {
    await editor.flashNotification(
      "No png, svg or excalidraw diagrams attached to this page!",
      "error"
    );
    return;
  }
  if (matches.length === 1) {
    diagramPath = getDiagramPath(await editor.getCurrentPage(), matches[0]);
  } else {
    const options = matches.map((model) => ({
      name: model,
      description: "",
    }));
    const selectedDiagram = await editor.filterBox("Edit", options, "", "");
    if (!selectedDiagram) {
      await editor.flashNotification("No diagram selected!", "error");
      return;
    }
    diagramPath = getDiagramPath(await editor.getCurrentPage(), selectedDiagram.name);
  }
  await openFullScreenEditor(diagramPath);
}

/* "Excalidraw: Create diagram" 
 
Prompts for a filename
Creates a diagram file
Updates the code editor by adding a
  code block -> if the file is .excalidraw
  attachment to the image -> if the file is .png / .svg
 
*/

async function createDiagram(diagramType: DiagramType): Promise<void | false> {
  const text = await editor.getText();
  const selection = await editor.getSelection();
  const { from, to } = selection;
  const selectedText = text.slice(from, to);

  // Ask for diagram name (default: selected text or empty)
  let diagramName = await editor.prompt(
    "Enter a diagram name:",
    selectedText || ""
  );
  if (!diagramName) return false; // user cancelled

  diagramName = ensureExtension(diagramName, diagramType);

  const filePath = getDiagramPath(await editor.getCurrentPage(), diagramName);

  if (await fileAlreadyExists(filePath)) {
    return false;
  }

  await writeEmptyExcalidrawFile(filePath);

  if (diagramType === "Widget") {
    const isMarkdown = (await editor.getCurrentPageMeta()).contentType === "text/markdown";
    if (isMarkdown) {
      await insertExcalidrawBlock(from, to, filePath);
    } else {
      // you might be in document editor already...
      await openExcalidrawEditorWithFile(filePath);
    }
  } else {
    await insertAttachment(from, to, diagramName, filePath);
  }
}


function ensureExtension(name: string, type: DiagramType): string {
  const ext = getFileExtension(name);

  if (type === "Widget") {
    return ext === "excalidraw" ? name : `${name}.excalidraw`;
  }

  if (type === "Attachment") {
    if (ext === "svg" || ext === "png") return name;
    editor.flashNotification("No extension provided, svg chosen", "info");
    return `${name}.svg`;
  }

  return name;
}

function getDiagramPath(pagePath: string, diagramName: string): string {
  const parts = pagePath.split("/");
  parts.pop(); // remove the original file name
  parts.push(diagramName); // add the new file name
  return parts.join("/");
}

async function fileAlreadyExists(filePath: string): Promise<boolean> {
  if (await space.fileExists(filePath)) {
    const overwrite = await editor.confirm(
      "File already exists! Do you want to overwrite?"
    );
    return !overwrite;
  }
  return false;
}

async function writeEmptyExcalidrawFile(filePath: string): Promise<void> {
  const config = await getCollaborationConfig();
  
  let fileData: ExcalidrawFileData = {
    type: "excalidraw",
    version: 2,
    elements: [],
    appState: {},
    files: {}
  };
  
  // If collaboration is enabled, create a room
  if (config.enabled && config.serverUrl) {
    const roomInfo = await createCollaborationRoom(config.serverUrl);
    if (roomInfo) {
      fileData.roomId = roomInfo.roomId;
      fileData.roomKey = roomInfo.roomKey;
      fileData.collaborationServer = config.serverUrl;
      // Don't include elements/appState/files for collaborative files
      delete fileData.elements;
      delete fileData.appState;
      delete fileData.files;
    } else {
      await editor.flashNotification(
        "Could not create collaboration room, creating local file instead",
        "info"
      );
    }
  }
  
  const content = new TextEncoder().encode(JSON.stringify(fileData));
  await space.writeFile(filePath, content);
}

async function insertExcalidrawBlock(from: number, to: number, filePath: string): Promise<void> {
  const block = `\`\`\`excalidraw
url:${filePath}
height:500px
\`\`\``;
  await editor.replaceRange(from, to, block);
}

async function insertAttachment(from: number, to: number, name: string, filePath: string): Promise<void> {
  const link = `![${name}](${name})`;
  await editor.replaceRange(from, to, link);
  await openFullScreenEditor(filePath);
}

export async function createDiagramAsWidget(): Promise<void | false> {
  createDiagram("Widget");
}

async function isRoMode() {
  const isRoMode = (await system.getMode()) === "ro";
  if (isRoMode) {
    await editor.flashNotification(
      "Read only mode",
      "error"
    );
  }
  return isRoMode;
}

export async function createDiagramAsAttachment(): Promise<void | false> {
  createDiagram("Attachment");
}

function extractValue(content: string, key: string): string | null {
  const regex = new RegExp(`${key}:\\s*(.+)`, "i");
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

// Previewer iframe for the code widget
export async function showWidget(
  widgetContents: string
): Promise<{ html: string; script: string }> {
  const path = extractValue(widgetContents, "url");
  const height = extractValue(widgetContents, "height");
  const theme = extractValue(widgetContents, "theme");

  if (!path || !(await space.fileExists(path))) {
    return { html: `<pre>File does not exist</pre>`, script: "" };
  }

  // Read the file to check if it contains collaboration info
  const fileContent = await space.readFile(path);
  const decoder = new TextDecoder("utf-8");
  const jsonStr = decoder.decode(fileContent);
  
  try {
    const fileData: ExcalidrawFileData = JSON.parse(jsonStr);
    return getHtmlJs(path, 'widget', { 
      height: height || "600px", 
      theme: theme || undefined,
      roomId: fileData.roomId,
      roomKey: fileData.roomKey,
      collaborationServer: fileData.collaborationServer
    });
  } catch (e) {
    // If parsing fails, fall back to regular behavior
    return getHtmlJs(path, 'widget', { height: height || "600px", theme: theme || undefined });
  }
}

export function snippetSlashComplete(): SlashCompletions {
  return {
    options: [
      {
        label: "excalidraw",
        detail: "Create new Excalidraw diagram",
        invoke: "excalidraw.createDiagramAsWidget",
      },
    ],
  };
}
