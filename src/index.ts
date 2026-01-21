import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import { Buffer } from 'buffer';
import * as process from 'process';

// Farcaster Hubble API base URL (using Pinata's public hub)
const HUBBLE_API_BASE = "https://hub.pinata.cloud/v1";

// Create MCP server
const server = new McpServer({
  name: "farcaster-mcp",
  version: "1.0.0",
});

// Types for Farcaster API responses based on actual API structure
interface CastAddBody {
  text: string;
  mentions?: number[];
  mentionsPositions?: number[];
  parentCastId?: {
    fid: number;
    hash: string;
  };
  embeds?: any[];
  embedsDeprecated?: any[];
}

interface CastRemoveBody {
  targetHash: string;
}

interface CastData {
  type: string;
  fid: number;
  timestamp: number;
  network: string;
  castAddBody?: CastAddBody;
  castRemoveBody?: CastRemoveBody;
}

interface Cast {
  data: CastData;
  hash: string;
  hashScheme: string;
  signature: string;
  signatureScheme: string;
  signer: string;
}

interface UserData {
  type: number;
  fid: number;
  username?: string;
  displayName?: string;
  pfpUrl?: string;
  bio?: string;
}

// Farcaster user data type constants
const USER_DATA_TYPE_DISPLAY = "USER_DATA_TYPE_DISPLAY";
const USER_DATA_TYPE_DISPLAY_NAME = USER_DATA_TYPE_DISPLAY; // Alias for backward compatibility

interface FarcasterCastsResponse {
  messages: Cast[];
  nextPageToken?: string;
}

interface FarcasterUserDataResponse {
  messages: {
    data: {
      type: number;
      fid: number;
      userDataBody: {
        type: number;
        value: string;
      }
    }
  }[];
}

// Helper function to make API requests to Farcaster Hubble
async function fetchFromHubble(endpoint: string, params: Record<string, any> = {}) {
  try {
    console.error(`Fetching from ${HUBBLE_API_BASE}${endpoint} with params:`, params);
    const response = await axios.get(`${HUBBLE_API_BASE}${endpoint}`, {
      params
    });
    console.error(`Response status: ${response.status}`);
    return response.data;
  } catch (error) {
    console.error("Error fetching from Hubble API:", error);
    if (axios.isAxiosError(error) && error.response) {
      throw new Error(`Hubble API error: ${error.response.status} - ${error.response.data?.details || error.message}`);
    }
    throw new Error(`Failed to fetch from Hubble: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Helper function to get user data (username, display name)
async function getUserData(fid: number): Promise<UserData> {
  try {
    console.error(`Fetching user data for FID: ${fid}`);
    const userData: UserData = { fid, type: 0 };
    let foundDisplayName = false;
    
    // Get user data - only looking for display name
    try {
      // Log that we're fetching display name
      console.error(`Fetching display name for FID ${fid} from userDataByFid endpoint`);
      
      // Make the API call with no type filter to get all user data
      const userDataResponse = await fetchFromHubble(`/userDataByFid`, {
        fid
      }) as FarcasterUserDataResponse;
      
      console.error(`Got user data response with ${userDataResponse.messages?.length || 0} messages`);
      
      if (userDataResponse.messages && userDataResponse.messages.length > 0) {
        // Process user data messages
        for (const message of userDataResponse.messages) {
          if (message.data && message.data.userDataBody) {
            const type = message.data.userDataBody.type;
            const value = message.data.userDataBody.value;
            
            console.error(`Processing user data message with type ${type} and value "${value}"`);
            
            // Check if this is a display name
            // The API seems to return "USER_DATA_TYPE_DISPLAY" as the type
            if (String(type) === "USER_DATA_TYPE_DISPLAY" || String(type).includes("DISPLAY")) {
              userData.displayName = value;
              foundDisplayName = true;
              console.error(`Found display name: ${value}`);
            }
          }
        }
      } else {
        console.error(`No user data messages found for FID ${fid}`);
      }
      
      // Debug the userData object to see if displayName was set
      console.error(`After processing messages, userData.displayName = ${userData.displayName || 'undefined'}, foundDisplayName = ${foundDisplayName}`);
      
      // If we didn't find a display name, try a different approach
      if (!foundDisplayName) {
        console.error(`No display name found for FID ${fid}, trying alternative approach`);
        
        // Try fetching with specific type
        const specificResponse = await fetchFromHubble(`/userDataByFid`, {
          fid,
          user_data_type: 2 // Try with numeric value for DISPLAY
        }) as FarcasterUserDataResponse;
        
        if (specificResponse.messages && specificResponse.messages.length > 0) {
          for (const message of specificResponse.messages) {
            if (message.data && message.data.userDataBody) {
              const type = message.data.userDataBody.type;
              console.error(`Specific query: message type ${type}`);
              
              // Check for display name
              if (String(type) === "USER_DATA_TYPE_DISPLAY" || String(type).includes("DISPLAY") || type === 2) {
                userData.displayName = message.data.userDataBody.value;
                foundDisplayName = true;
                console.error(`Found display name in specific query: ${userData.displayName}`);
                break;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error getting user data: ${error}`);
    }
    
    console.error(`Final user data for FID ${fid}: displayName=${userData.displayName || 'not found'}, foundDisplayName=${foundDisplayName}`);
    return userData;
  } catch (error) {
    console.error("Error fetching user data:", error);
    return { fid, type: 0 };
  }
}

// Helper function to format casts
async function formatCasts(casts: Cast[], limit: number = 10) {
  if (!casts || casts.length === 0) {
    return "No casts found.";
  }
  
  console.error(`Formatting ${casts.length} casts`);
  
  // Filter out cast removes and keep only cast adds
  const castAdds = casts.filter(cast => 
    cast.data && cast.data.type === "MESSAGE_TYPE_CAST_ADD" && cast.data.castAddBody
  );
  
  if (castAdds.length === 0) {
    return "No cast additions found.";
  }
  
  // Limit the number of casts
  const limitedCasts = castAdds.slice(0, limit);
  
  // First, collect all unique FIDs to fetch user data in batch
  const uniqueFids = new Set<number>();
  limitedCasts.forEach(cast => {
    if (cast.data && cast.data.fid) {
      uniqueFids.add(cast.data.fid);
    }
  });
  
  console.error(`Found ${uniqueFids.size} unique FIDs, fetching user data for all of them`);
  
  // Fetch user data for all FIDs
  const userDataMap = new Map<number, UserData>();
  const userDataPromises = Array.from(uniqueFids).map(async fid => {
    try {
      const userData = await getUserData(fid);
      userDataMap.set(fid, userData);
      console.error(`Fetched user data for FID ${fid}: displayName=${userData.displayName}`);
    } catch (error) {
      console.error(`Error fetching user data for FID ${fid}:`, error);
      // Add a minimal entry to the map so we don't fail later
      userDataMap.set(fid, { fid, type: 0 });
    }
  });
  
  // Wait for all user data to be fetched
  await Promise.all(userDataPromises);
  console.error(`Completed fetching user data for all ${uniqueFids.size} FIDs`);
  
  // Now format all casts with the pre-fetched user data
  const formattedCastsPromises = limitedCasts.map(async (cast, index) => {
    try {
      // Check if cast and cast.data exist
      if (!cast || !cast.data || !cast.data.castAddBody) {
        console.error(`Invalid cast at index ${index}:`, cast);
        return `${index + 1}. [Invalid cast format]`;
      }
      
      const fid = cast.data.fid;
      const userData = userDataMap.get(fid) || { fid, type: 0 };
      
      // Convert Farcaster epoch timestamp to date
      const farcasterEpoch = new Date('2021-01-01T00:00:00Z').getTime() / 1000;
      const date = new Date((cast.data.timestamp + farcasterEpoch) * 1000).toLocaleString();
      
      // Use displayName if available, otherwise just show the index
      const displayName = userData.displayName || `User ${fid}`;
      
      // Check if this is a reply to another cast
      let replyInfo = "";
      if (cast.data.castAddBody.parentCastId) {
        replyInfo = `   Reply to: ${cast.data.castAddBody.parentCastId.fid}/${cast.data.castAddBody.parentCastId.hash}\n`;
      }
      
      // Check if there are embeds
      let embedsInfo = "";
      if (cast.data.castAddBody.embeds && cast.data.castAddBody.embeds.length > 0) {
        embedsInfo = "   Embeds: " + cast.data.castAddBody.embeds.map((embed: any) => {
          if (embed.url) return embed.url;
          return "embedded content";
        }).join(", ") + "\n";
      }
      
      return `
${index + 1}. ${displayName}
   FID: ${fid}
   Time: ${date}
   Text: ${cast.data.castAddBody.text}
${replyInfo}${embedsInfo}   Cast ID: ${cast.hash}
   `;
    } catch (error) {
      console.error(`Error formatting cast at index ${index}:`, error);
      return `${index + 1}. [Error formatting cast]`;
    }
  });
  
  const formattedCasts = await Promise.all(formattedCastsPromises);
  return formattedCasts.join("\n---\n");
}

// Helper function to find FID by username
async function getFidByUsername(username: string): Promise<number | null> {
  try {
    console.error(`Looking up FID for username: ${username}`);
    
    // Try with the original endpoint first
    try {
      const response = await fetchFromHubble(`/userNameProofByName`, {
        name: username
      });
      
      console.error(`Username proof response:`, JSON.stringify(response, null, 2));
      
      if (response && response.fid) {
        console.error(`Found FID ${response.fid} for username ${username}`);
        return response.fid;
      }
      
      if (response && response.proof && response.proof.fid) {
        console.error(`Found FID ${response.proof.fid} for username ${username}`);
        return response.proof.fid;
      }
    } catch (error) {
      console.error(`Error with first endpoint attempt:`, error);
    }
    
    // Try with a different case variation
    try {
      console.error(`Trying with different case: /usernameproofbyname`);
      const response2 = await fetchFromHubble(`/usernameproofbyname`, {
        name: username
      });
      
      console.error(`Second attempt response:`, JSON.stringify(response2, null, 2));
      
      if (response2 && response2.fid) {
        console.error(`Found FID ${response2.fid} for username ${username}`);
        return response2.fid;
      }
      
      if (response2 && response2.proof && response2.proof.fid) {
        console.error(`Found FID ${response2.proof.fid} for username ${username}`);
        return response2.proof.fid;
      }
    } catch (error) {
      console.error(`Error with second endpoint attempt:`, error);
    }
    
    // Try with a different endpoint format
    try {
      console.error(`Trying with different endpoint format: /usernameProofs/${username}`);
      const response3 = await fetchFromHubble(`/usernameProofs/${username}`);
      
      console.error(`Third attempt response:`, JSON.stringify(response3, null, 2));
      
      if (response3 && response3.fid) {
        console.error(`Found FID ${response3.fid} for username ${username}`);
        return response3.fid;
      }
      
      if (response3 && response3.proof && response3.proof.fid) {
        console.error(`Found FID ${response3.proof.fid} for username ${username}`);
        return response3.proof.fid;
      }
    } catch (error) {
      console.error(`Error with third endpoint attempt:`, error);
    }
    
    // If we get here, we couldn't find the FID
    console.error(`No FID found for username ${username} after trying multiple endpoints`);
    return null;
  } catch (error) {
    console.error(`Error finding FID by username ${username}:`, error);
    return null;
  }
}

// Helper function to get channel URL from channel name or ID
async function getChannelUrl(channelNameOrId: string): Promise<string | null> {
  try {
    // If it's already a full URL or hash format, return it as is
    if (channelNameOrId.startsWith('https://') || 
        channelNameOrId.startsWith('chain://') || 
        channelNameOrId.startsWith('0x')) {
      return channelNameOrId;
    }
    
    // First try the direct Warpcast URL approach
    const warpcastUrl = `https://warpcast.com/~/channel/${channelNameOrId}`;
    
    // Try to fetch channel info from Warpcast API as a fallback
    console.error(`Fetching channel info for "${channelNameOrId}" from Warpcast API`);
    try {
      const response = await axios.get('https://api.warpcast.com/v2/all-channels');
      
      if (response.data && response.data.result && response.data.result.channels) {
        // Look for channel by ID or name (case insensitive)
        const channelNameLower = channelNameOrId.toLowerCase();
        const channel = response.data.result.channels.find((c: any) => 
          c.id.toLowerCase() === channelNameLower || 
          c.name.toLowerCase() === channelNameLower
        );
        
        if (channel) {
          console.error(`Found channel: ${channel.name} (${channel.id}) with URL: ${channel.url}`);
          return channel.url; // Return the hash URL from the API
        }
      }
      
      console.error(`Channel "${channelNameOrId}" not found in Warpcast API response, using direct Warpcast URL`);
      return warpcastUrl; // Fall back to direct URL if not found in API
    } catch (error) {
      console.error(`Error fetching from Warpcast API: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`Falling back to direct Warpcast URL: ${warpcastUrl}`);
      return warpcastUrl; // Fall back to direct URL if API call fails
    }
  } catch (error) {
    console.error(`Error creating channel URL: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// Main function to start the server
async function main() {
  try {
    // Register tool for getting casts by user FID
    server.tool(
      "get-user-casts",
      "Get casts from a specific Farcaster user by FID",
      {
        fid: z.number().describe("Farcaster user ID (FID)"),
        limit: z.number().optional().describe("Maximum number of casts to return (default: 10)")
      },
      async ({ fid, limit = 10 }: { fid: number; limit?: number }) => {
        try {
          console.error(`Fetching casts for FID ${fid} with limit ${limit}`);
          const response = await fetchFromHubble(`/castsByFid`, {
            fid,
            pageSize: limit,
            reverse: true // Get newest first
          }) as FarcasterCastsResponse;
          
          console.error(`Got response with ${response.messages?.length || 0} messages`);
          
          if (!response.messages || response.messages.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No casts found for FID ${fid}`
                }
              ]
            };
          }
          
          const castsText = await formatCasts(response.messages, limit);
          
          return {
            content: [
              {
                type: "text",
                text: `# Casts from FID ${fid}\n\n${castsText}`
              }
            ]
          };
        } catch (error) {
          console.error("Error in get-user-casts:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error fetching casts: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };
        }
      }
    );
    
    // Register tool for getting casts from a channel (parent URL)
    server.tool(
      "get-channel-casts",
      "Get casts from a specific Farcaster channel",
      {
        channel: z.string().describe("Channel name (e.g., 'aichannel') or URL"),
        limit: z.number().optional().describe("Maximum number of casts to return (default: 10)")
      },
      async ({ channel, limit = 10 }: { channel: string; limit?: number }) => {
        try {
          // First, determine the channel URL
          let channelUrl: string | null = null;
          
          // If it's already a URL format, use it directly
          if (channel.startsWith('https://') || 
              channel.startsWith('chain://') || 
              channel.startsWith('0x')) {
            channelUrl = channel;
            console.error(`Using provided URL: ${channelUrl}`);
          } else {
            // Otherwise, get the URL for the channel name
            channelUrl = await getChannelUrl(channel);
            
            if (!channelUrl) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Failed to create URL for channel "${channel}".`
                  }
                ],
                isError: true
              };
            }
            console.error(`Using URL for channel "${channel}": ${channelUrl}`);
          }
          
          // Set up parameters for the API call
          const params: Record<string, any> = {
            pageSize: limit,
            reverse: true // Get newest first
          };
          
          // Use url parameter for the API call as shown in the example
          params.url = channelUrl;
          
          console.error(`Fetching casts with params:`, params);
          let response: FarcasterCastsResponse;
          
          try {
            response = await fetchFromHubble(`/castsByParent`, params) as FarcasterCastsResponse;
          } catch (error) {
            // If the first attempt fails and we're using a Warpcast URL, try the API lookup approach
            if (channelUrl.includes('warpcast.com') && !channel.startsWith('https://')) {
              console.error(`First attempt failed, trying to get hash URL from Warpcast API`);
              
              // Try to fetch channel info from Warpcast API
              try {
                const apiResponse = await axios.get('https://api.warpcast.com/v2/all-channels');
                
                if (apiResponse.data && apiResponse.data.result && apiResponse.data.result.channels) {
                  // Look for channel by ID or name (case insensitive)
                  const channelNameLower = channel.toLowerCase();
                  const channelInfo = apiResponse.data.result.channels.find((c: any) => 
                    c.id.toLowerCase() === channelNameLower || 
                    c.name.toLowerCase() === channelNameLower
                  );
                  
                  if (channelInfo && channelInfo.url) {
                    console.error(`Found channel in API: ${channelInfo.name} (${channelInfo.id}) with URL: ${channelInfo.url}`);
                    
                    // Try again with the hash URL
                    params.url = channelInfo.url;
                    console.error(`Retrying with hash URL: ${channelInfo.url}`);
                    response = await fetchFromHubble(`/castsByParent`, params) as FarcasterCastsResponse;
                  } else {
                    throw new Error(`Channel "${channel}" not found in Warpcast API`);
                  }
                } else {
                  throw error; // Re-throw the original error if API response is invalid
                }
              } catch (apiError) {
                console.error(`Error fetching from Warpcast API: ${apiError instanceof Error ? apiError.message : String(apiError)}`);
                throw error; // Re-throw the original error if API call fails
              }
            } else {
              throw error; // Re-throw the error if it's not a Warpcast URL or if it's already a full URL
            }
          }
          
          if (!response.messages || response.messages.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No casts found for channel "${channel}"`
                }
              ]
            };
          }
          
          const castsText = await formatCasts(response.messages, limit);
          
          return {
            content: [
              {
                type: "text",
                text: `# Recent Casts in Channel "${channel}"\n\n${castsText}`
              }
            ]
          };
        } catch (error) {
          console.error("Error in get-channel-casts:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error fetching channel casts: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };
        }
      }
    );
    
    // Register tool for getting casts by username
    server.tool(
      "get-username-casts",
      "Get casts from a specific Farcaster username",
      {
        username: z.string().describe("Farcaster username"),
        limit: z.number().optional().describe("Maximum number of casts to return (default: 10)")
      },
      async ({ username, limit = 10 }: { username: string; limit?: number }) => {
        try {
          console.error(`Looking up casts for username: ${username}`);
          
          // First, we need to get the FID for the username
          const fid = await getFidByUsername(username);
          
          if (!fid) {
            return {
              content: [
                {
                  type: "text",
                  text: `User "${username}" not found.`
                }
              ],
              isError: true
            };
          }
          
          console.error(`Found FID ${fid} for username ${username}, fetching user data`);
          
          // Get user data to ensure we have the display name
          const userData = await getUserData(fid);
          
          // Use the display name if available, otherwise use the FID
          const displayName = userData.displayName || `FID: ${fid}`;
          
          console.error(`User data: displayName=${displayName}`);
          
          // Now get the casts for this FID
          const response = await fetchFromHubble(`/castsByFid`, {
            fid,
            pageSize: limit,
            reverse: true // Get newest first
          }) as FarcasterCastsResponse;
          
          if (!response.messages || response.messages.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No casts found for ${displayName} (FID: ${fid})`
                }
              ]
            };
          }
          
          const castsText = await formatCasts(response.messages, limit);
          
          return {
            content: [
              {
                type: "text",
                text: `# Casts from ${displayName}\n\n${castsText}`
              }
            ]
          };
        } catch (error) {
          console.error("Error in get-username-casts:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error fetching casts by username: ${error instanceof Error ? error.message : String(error)}`
              }
            ],
            isError: true
          };
        }
      }
    );

    // Register tool for getting user profile
    server.tool(
      "get-user-profile",
      "Get a Farcaster user's profile information including bio, display name, and profile picture",
      {
        fid: z.number().optional().describe("Farcaster user ID (FID)"),
        username: z.string().optional().describe("Farcaster username (alternative to FID)")
      },
      async ({ fid, username }: { fid?: number; username?: string }) => {
        try {
          let targetFid = fid;

          // If username provided, look up the FID first
          if (!targetFid && username) {
            console.error(`Looking up FID for username: ${username}`);
            targetFid = await getFidByUsername(username) ?? undefined;
            if (!targetFid) {
              return {
                content: [{ type: "text", text: `User "${username}" not found.` }],
                isError: true
              };
            }
          }

          if (!targetFid) {
            return {
              content: [{ type: "text", text: "Please provide either a FID or username." }],
              isError: true
            };
          }

          console.error(`Fetching profile for FID: ${targetFid}`);

          const userDataResponse = await fetchFromHubble(`/userDataByFid`, { fid: targetFid });

          if (!userDataResponse.messages || userDataResponse.messages.length === 0) {
            return {
              content: [{ type: "text", text: `No profile data found for FID ${targetFid}` }]
            };
          }

          // Parse user data messages
          const profile: Record<string, string> = { fid: String(targetFid) };

          for (const message of userDataResponse.messages) {
            if (message.data?.userDataBody) {
              const { type, value } = message.data.userDataBody;
              switch (type) {
                case "USER_DATA_TYPE_PFP":
                  profile.pfp = value;
                  break;
                case "USER_DATA_TYPE_DISPLAY":
                  profile.displayName = value;
                  break;
                case "USER_DATA_TYPE_BIO":
                  profile.bio = value;
                  break;
                case "USER_DATA_TYPE_USERNAME":
                  profile.username = value;
                  break;
                case "USER_DATA_TYPE_URL":
                  profile.url = value;
                  break;
              }
            }
          }

          const profileText = `# Profile: ${profile.displayName || profile.username || `FID ${targetFid}`}

**FID:** ${targetFid}
**Username:** ${profile.username || "N/A"}
**Display Name:** ${profile.displayName || "N/A"}
**Bio:** ${profile.bio || "N/A"}
**Profile Picture:** ${profile.pfp || "N/A"}
**URL:** ${profile.url || "N/A"}`;

          return {
            content: [{ type: "text", text: profileText }]
          };
        } catch (error) {
          console.error("Error in get-user-profile:", error);
          return {
            content: [{ type: "text", text: `Error fetching profile: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Register tool for getting cast reactions (likes and recasts)
    server.tool(
      "get-cast-reactions",
      "Get likes and recasts for a specific cast",
      {
        fid: z.number().describe("FID of the cast author"),
        hash: z.string().describe("Hash of the cast"),
        type: z.enum(["likes", "recasts", "all"]).optional().describe("Type of reactions to fetch (default: all)")
      },
      async ({ fid, hash, type = "all" }: { fid: number; hash: string; type?: "likes" | "recasts" | "all" }) => {
        try {
          console.error(`Fetching reactions for cast ${hash} by FID ${fid}`);

          const results: string[] = [];

          // Fetch likes if requested
          if (type === "likes" || type === "all") {
            try {
              const likesResponse = await fetchFromHubble(`/reactionsByCast`, {
                target_fid: fid,
                target_hash: hash,
                reaction_type: "Like",
                pageSize: 50
              });

              const likeCount = likesResponse.messages?.length || 0;
              results.push(`**Likes:** ${likeCount}`);

              if (likeCount > 0 && likeCount <= 10) {
                const likerFids = likesResponse.messages.map((m: any) => m.data.fid);
                results.push(`Liked by FIDs: ${likerFids.join(", ")}`);
              }
            } catch (error) {
              console.error("Error fetching likes:", error);
              results.push("**Likes:** Error fetching");
            }
          }

          // Fetch recasts if requested
          if (type === "recasts" || type === "all") {
            try {
              const recastsResponse = await fetchFromHubble(`/reactionsByCast`, {
                target_fid: fid,
                target_hash: hash,
                reaction_type: "Recast",
                pageSize: 50
              });

              const recastCount = recastsResponse.messages?.length || 0;
              results.push(`**Recasts:** ${recastCount}`);

              if (recastCount > 0 && recastCount <= 10) {
                const recasterFids = recastsResponse.messages.map((m: any) => m.data.fid);
                results.push(`Recasted by FIDs: ${recasterFids.join(", ")}`);
              }
            } catch (error) {
              console.error("Error fetching recasts:", error);
              results.push("**Recasts:** Error fetching");
            }
          }

          return {
            content: [{
              type: "text",
              text: `# Reactions for Cast\n**Cast:** ${hash}\n**Author FID:** ${fid}\n\n${results.join("\n")}`
            }]
          };
        } catch (error) {
          console.error("Error in get-cast-reactions:", error);
          return {
            content: [{ type: "text", text: `Error fetching reactions: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Register tool for listing channels
    server.tool(
      "list-channels",
      "List Farcaster channels with optional filtering",
      {
        limit: z.number().optional().describe("Maximum number of channels to return (default: 20)"),
        search: z.string().optional().describe("Search term to filter channels by name or ID")
      },
      async ({ limit = 20, search }: { limit?: number; search?: string }) => {
        try {
          console.error(`Fetching channels list, limit: ${limit}, search: ${search || "none"}`);

          const response = await axios.get('https://api.warpcast.com/v2/all-channels');

          if (!response.data?.result?.channels) {
            return {
              content: [{ type: "text", text: "Failed to fetch channels from Warpcast API" }],
              isError: true
            };
          }

          let channels = response.data.result.channels;

          // Filter by search term if provided
          if (search) {
            const searchLower = search.toLowerCase();
            channels = channels.filter((c: any) =>
              c.id.toLowerCase().includes(searchLower) ||
              c.name.toLowerCase().includes(searchLower) ||
              (c.description && c.description.toLowerCase().includes(searchLower))
            );
          }

          // Sort by follower count (most popular first)
          channels.sort((a: any, b: any) => (b.followerCount || 0) - (a.followerCount || 0));

          // Limit results
          channels = channels.slice(0, limit);

          if (channels.length === 0) {
            return {
              content: [{ type: "text", text: search ? `No channels found matching "${search}"` : "No channels found" }]
            };
          }

          const channelList = channels.map((c: any, i: number) =>
            `${i + 1}. **${c.name}** (/${c.id})
   Followers: ${c.followerCount || 0} | Members: ${c.memberCount || 0}
   ${c.description ? c.description.substring(0, 100) + (c.description.length > 100 ? "..." : "") : "No description"}`
          ).join("\n\n");

          return {
            content: [{
              type: "text",
              text: `# Farcaster Channels${search ? ` matching "${search}"` : ""}\n\n${channelList}`
            }]
          };
        } catch (error) {
          console.error("Error in list-channels:", error);
          return {
            content: [{ type: "text", text: `Error fetching channels: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Register tool for getting user's following list
    server.tool(
      "get-user-following",
      "Get the list of users that a Farcaster user follows",
      {
        fid: z.number().describe("Farcaster user ID (FID)"),
        limit: z.number().optional().describe("Maximum number of results (default: 25)")
      },
      async ({ fid, limit = 25 }: { fid: number; limit?: number }) => {
        try {
          console.error(`Fetching following list for FID: ${fid}`);

          const response = await fetchFromHubble(`/linksByFid`, {
            fid,
            link_type: "follow",
            pageSize: limit
          });

          if (!response.messages || response.messages.length === 0) {
            return {
              content: [{ type: "text", text: `FID ${fid} is not following anyone or user not found.` }]
            };
          }

          const followingFids = response.messages
            .filter((m: any) => m.data?.linkBody?.targetFid)
            .map((m: any) => m.data.linkBody.targetFid);

          // Fetch display names for the first 10 users
          const displayNames: string[] = [];
          for (const targetFid of followingFids.slice(0, 10)) {
            try {
              const userData = await getUserData(targetFid);
              displayNames.push(`- FID ${targetFid}: ${userData.displayName || "Unknown"}`);
            } catch {
              displayNames.push(`- FID ${targetFid}`);
            }
          }

          const moreCount = followingFids.length > 10 ? followingFids.length - 10 : 0;

          return {
            content: [{
              type: "text",
              text: `# Following List for FID ${fid}\n\n**Total shown:** ${followingFids.length}\n\n${displayNames.join("\n")}${moreCount > 0 ? `\n\n...and ${moreCount} more` : ""}`
            }]
          };
        } catch (error) {
          console.error("Error in get-user-following:", error);
          return {
            content: [{ type: "text", text: `Error fetching following list: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Register tool for getting user's followers list
    server.tool(
      "get-user-followers",
      "Get the list of users who follow a Farcaster user",
      {
        fid: z.number().describe("Farcaster user ID (FID)"),
        limit: z.number().optional().describe("Maximum number of results (default: 25)")
      },
      async ({ fid, limit = 25 }: { fid: number; limit?: number }) => {
        try {
          console.error(`Fetching followers list for FID: ${fid}`);

          const response = await fetchFromHubble(`/linksByTargetFid`, {
            target_fid: fid,
            link_type: "follow",
            pageSize: limit
          });

          if (!response.messages || response.messages.length === 0) {
            return {
              content: [{ type: "text", text: `FID ${fid} has no followers or user not found.` }]
            };
          }

          const followerFids = response.messages
            .filter((m: any) => m.data?.fid)
            .map((m: any) => m.data.fid);

          // Fetch display names for the first 10 users
          const displayNames: string[] = [];
          for (const followerFid of followerFids.slice(0, 10)) {
            try {
              const userData = await getUserData(followerFid);
              displayNames.push(`- FID ${followerFid}: ${userData.displayName || "Unknown"}`);
            } catch {
              displayNames.push(`- FID ${followerFid}`);
            }
          }

          const moreCount = followerFids.length > 10 ? followerFids.length - 10 : 0;

          return {
            content: [{
              type: "text",
              text: `# Followers of FID ${fid}\n\n**Total shown:** ${followerFids.length}\n\n${displayNames.join("\n")}${moreCount > 0 ? `\n\n...and ${moreCount} more` : ""}`
            }]
          };
        } catch (error) {
          console.error("Error in get-user-followers:", error);
          return {
            content: [{ type: "text", text: `Error fetching followers list: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true
          };
        }
      }
    );

    // Connect to transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Farcaster MCP Server running on stdio");
  } catch (error) {
    console.error("Fatal error in main():", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
}); 