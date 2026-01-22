[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/manimohans-farcaster-mcp-badge.png)](https://mseep.ai/app/manimohans-farcaster-mcp)

# Farcaster MCP Server

An MCP server that provides tools to interact with the Farcaster network ([farcaster.xyz](https://www.farcaster.xyz)), allowing AI models to fetch casts, search channels, and analyze content.

<a href="https://glama.ai/mcp/servers/koo5epnlc7">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/koo5epnlc7/badge" alt="Farcaster Server MCP server" />
</a>

## Features

- **Get User Casts**: Retrieve casts from a specific Farcaster user by FID
- **Get Username Casts**: Retrieve casts from a specific Farcaster user by username
- **Get Channel Casts**: Retrieve casts from a specific Farcaster channel
- **Get User Profile**: Get detailed profile information (bio, display name, pfp, etc.)
- **Get Cast Reactions**: Get likes and recasts for a specific cast
- **List Channels**: Browse and search Farcaster channels
- **Get User Following**: See who a user follows
- **Get User Followers**: See who follows a user

## Installation

```bash
# Clone the repository
git clone https://github.com/manimohans/farcaster-mcp.git
cd farcaster-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

## Usage

### Running the server

```bash
npm start
```

### Using with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node ./build/index.js
```

### Using with Claude for Desktop

1. Install [Claude for Desktop](https://claude.ai/download)
2. Open your Claude for Desktop App configuration at:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

3. Add the following configuration:

```json
{
  "mcpServers": {
    "farcaster": {
      "command": "node",
      "args": ["/absolute/path/to/farcaster-mcp/build/index.js"]
    }
  }
}
```

4. Restart Claude for Desktop

### Using with Smithery

This project includes Smithery configuration files for easy deployment:

```bash
# Install Smithery CLI
npm install -g @smithery/cli

# Deploy to Smithery (specify the client, e.g., claude, cline, windsurf, etc.)
npx @smithery/cli install @manimohans/farcaster-mcp --client claude
```

Available client options: claude, cline, windsurf, roo-cline, witsy, enconvo

### Available Tools

#### get-user-casts

Retrieves casts from a specific Farcaster user by their FID (Farcaster ID).

Parameters:
- `fid`: Farcaster user ID (number)
- `limit` (optional): Maximum number of casts to return (default: 10)

Example query: "Show me the latest casts from FID 6846."

#### get-username-casts

Retrieves casts from a specific Farcaster user by their username.

Parameters:
- `username`: Farcaster username (string)
- `limit` (optional): Maximum number of casts to return (default: 10)

Example query: "Show me the latest casts from username 'mani'."

#### get-channel-casts

Retrieves casts from a specific Farcaster channel.

Parameters:
- `channel`: Channel name or URL (string)
- `limit` (optional): Maximum number of casts to return (default: 10)

Example query: "Show me the latest casts from the 'aichannel' channel."

#### get-user-profile

Gets detailed profile information for a Farcaster user.

Parameters:
- `fid` (optional): Farcaster user ID (number)
- `username` (optional): Farcaster username (string)

Example query: "Get the profile for username 'dwr.eth'."

#### get-cast-reactions

Gets likes and recasts for a specific cast.

Parameters:
- `fid`: FID of the cast author (number)
- `hash`: Hash of the cast (string)
- `type` (optional): Type of reactions - "likes", "recasts", or "all" (default: "all")

Example query: "How many likes does cast 0x1cb62ca3... by FID 6846 have?"

#### list-channels

Lists Farcaster channels with optional search filtering.

Parameters:
- `limit` (optional): Maximum number of channels to return (default: 20)
- `search` (optional): Search term to filter channels by name or ID

Example query: "List the top 10 channels about AI."

#### get-user-following

Gets the list of users that a Farcaster user follows.

Parameters:
- `fid`: Farcaster user ID (number)
- `limit` (optional): Maximum number of results (default: 25)

Example query: "Who does FID 3 follow?"

#### get-user-followers

Gets the list of users who follow a Farcaster user.

Parameters:
- `fid`: Farcaster user ID (number)
- `limit` (optional): Maximum number of results (default: 25)

Example query: "Who follows FID 3?"

## API Details

This implementation uses the Farcaster Hubble API to fetch data.

## Development

```bash
# Run in development mode
npm run dev
```

## License

MIT
