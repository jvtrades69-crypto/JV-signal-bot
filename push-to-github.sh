#!/bin/bash
# Push a file to GitHub via n8n webhook
# Usage: ./push-to-github.sh [file_path] [commit_message]
#
# Example: ./push-to-github.sh embeds.js "Fix breakeven: yellow emoji + Breakeven text"

# Configuration
N8N_WEBHOOK_URL="https://raze11.app.n8n.cloud/webhook/push-to-github"
OWNER="jvtrades69-crypto"
REPO="JV-signal-bot"

# Get arguments
FILE_PATH="${1:-embeds.js}"
COMMIT_MESSAGE="${2:-Update $FILE_PATH}"

# Check if file exists
if [ ! -f "$FILE_PATH" ]; then
    echo "Error: File '$FILE_PATH' not found"
    exit 1
fi

echo "Pushing $FILE_PATH to GitHub..."
echo "Commit message: $COMMIT_MESSAGE"

# Base64 encode the file content
CONTENT=$(base64 -w 0 "$FILE_PATH")

# Send to n8n webhook
RESPONSE=$(curl -s -X POST "$N8N_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{
        \"owner\": \"$OWNER\",
        \"repo\": \"$REPO\",
        \"path\": \"$FILE_PATH\",
        \"message\": \"$COMMIT_MESSAGE\",
        \"content\": \"$CONTENT\"
    }")

echo "Response from n8n:"
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"

# Check if successful
if echo "$RESPONSE" | grep -q '"sha"'; then
    echo ""
    echo "✅ Successfully pushed $FILE_PATH to GitHub!"
else
    echo ""
    echo "❌ Push may have failed. Check the response above."
fi
