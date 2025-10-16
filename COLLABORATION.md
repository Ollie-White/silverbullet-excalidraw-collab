# Excalidraw Collaboration Server Integration

## Overview

This plugin now supports integration with excalidraw-room collaboration servers. When enabled, diagrams are stored on a collaboration server instead of locally, enabling real-time collaborative editing.

## Architecture

### Backend (excalidraw.ts)

The plugin now includes collaboration support through:

1. **Configuration Management**
   - `getCollaborationConfig()`: Retrieves collaboration settings from clientStore
   - Default server URL: `https://excalidraw-room.example.com`
   - Collaboration enabled by default (can be disabled)

2. **Room Creation**
   - `createCollaborationRoom(serverUrl)`: Creates a new room via HTTP POST to `/api/v2/rooms`
   - Returns `{ roomId, roomKey }` on success
   - Returns `null` on failure (with console logging)

3. **File Format**
   - **Collaborative files**: Store only room metadata
     ```json
     {
       "type": "excalidraw",
       "version": 2,
       "roomId": "abc123",
       "roomKey": "xyz789",
       "collaborationServer": "https://server.com"
     }
     ```
   - **Local files**: Continue to store full drawing data (elements, appState, files)

4. **Data Flow**
   - `writeEmptyExcalidrawFile()`: Creates room if collaboration enabled
   - `showWidget()`: Extracts room info from file and passes to components
   - `getHtmlJs()`: Embeds room data in HTML data attributes

### Frontend (React Components)

All editor components (editor.tsx, widget.tsx, svgeditor.tsx) now:

1. **Accept Collaboration Props**
   - `roomId?: string`
   - `roomKey?: string`
   - `collaborationServer?: string`

2. **Enable Collaboration Mode**
   - Calculate `isCollaborating = !!(roomId && roomKey && collaborationServer)`
   - Pass to Excalidraw component's `isCollaborating` prop

3. **Data Extraction**
   - Read collaboration data from `dataset` attributes
   - Extract from loaded file JSON
   - Pass through component hierarchy

## Configuration

Users can configure collaboration via SilverBullet's clientStore:

```javascript
// Set collaboration server URL
await clientStore.set("excalidraw.collaborationServerUrl", "https://your-server.com");

// Enable/disable collaboration
await clientStore.set("excalidraw.collaborationEnabled", true);
```

Or via the SilverBullet UI:
1. Open command palette
2. Run `Client: Set Value`
3. Set `excalidraw.collaborationServerUrl` to your server URL
4. Set `excalidraw.collaborationEnabled` to `true`/`false`

## Usage Flow

### Creating a New Diagram

1. User runs "Excalidraw: Create diagram" command
2. Plugin checks collaboration config
3. If enabled and server URL configured:
   - Makes HTTP POST to `{serverUrl}/api/v2/rooms`
   - Receives `{ roomId, roomKey }`
   - Saves metadata file (not drawing data)
4. If disabled or server unavailable:
   - Falls back to local file
   - Shows notification: "Could not create collaboration room, creating local file instead"

### Opening a Diagram

1. Plugin reads file content
2. If file contains `roomId` and `roomKey`:
   - Passes to React components as props
   - Components set `isCollaborating={true}`
   - Excalidraw connects to collaboration server
3. If file contains drawing data:
   - Loads locally as before
   - Components set `isCollaborating={false}`

## Error Handling

- **Server Unavailable**: Falls back to local file creation
- **Invalid Response**: Logs error to console, creates local file
- **Network Errors**: Caught and logged, creates local file
- **User Notification**: Shows info message when fallback occurs

## API Endpoints

The plugin expects the collaboration server to provide:

### POST /api/v2/rooms

**Request:**
```
POST /api/v2/rooms HTTP/1.1
Content-Type: application/json
```

**Response:**
```json
{
  "roomId": "unique-room-identifier",
  "roomKey": "encryption-key-for-room"
}
```

## Excalidraw Component Integration

The Excalidraw React component handles collaboration internally when:
- `isCollaborating` prop is `true`
- Room data is available in the initial state

The component:
- Establishes WebSocket connection to collaboration server
- Syncs drawing elements in real-time
- Handles conflict resolution
- Manages presence indicators (cursors, selections)

## Backward Compatibility

- Existing local files continue to work
- No migration required
- Users can choose to use collaboration or not
- Mixed usage supported (some files local, some collaborative)

## Security Considerations

- Room keys should be treated as secrets
- Files containing room keys grant access to collaborative sessions
- Consider file permissions in your SilverBullet space
- The collaboration server should implement proper authentication

## Troubleshooting

### Collaboration Not Working

1. Check server URL configuration:
   ```javascript
   await clientStore.get("excalidraw.collaborationServerUrl")
   ```

2. Verify collaboration is enabled:
   ```javascript
   await clientStore.get("excalidraw.collaborationEnabled")
   ```

3. Check browser console for errors

4. Verify server is accessible (try accessing in browser)

### Falling Back to Local Files

If you see "Could not create collaboration room" notifications:
- Server may be down or unreachable
- Network connectivity issues
- Invalid server URL
- Server API version mismatch

Check browser console and network tab for detailed error messages.

## Development

To test collaboration locally:

1. Set up an excalidraw-room server (see excalidraw-room documentation)
2. Configure the plugin to use your local server
3. Create a new diagram
4. Open the same diagram in multiple browser windows
5. Verify changes sync across windows

## Future Enhancements

Potential improvements:
- UI for managing collaboration settings
- List of active collaborators
- Room sharing/invitation links
- Offline support with sync on reconnect
- Collaboration status indicator in UI
