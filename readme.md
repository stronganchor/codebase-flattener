# Codebase Flattener WordPress Plugin

A WordPress plugin that flattens GitHub repositories into AI-ready prompts with selective file inclusion. Perfect for preparing code context for AI assistants like Claude, GPT-4, etc.

## Features

- 🚀 **Direct GitHub Integration** - No need to clone repos locally
- 📱 **Mobile Friendly** - Access from your phone through WordPress admin
- 🎯 **Selective File Loading** - Choose exactly which files to include
- 💾 **Smart Caching** - Files are cached after fetching to avoid re-downloading
- 🔒 **Private Repo Support** - Use GitHub personal access tokens
- 📊 **Token Counting** - Real-time estimation of prompt size
- 🎨 **File Type Filtering** - Specify which extensions to include
- 🚫 **Folder Ignoring** - Skip node_modules, vendor, etc.
- 📝 **Custom Instructions** - Add your own instructions to every prompt
- 🕐 **Recent Repos** - Quick access to previously used repositories

## Installation

1. **Create Plugin Directory:**
   ```
   wp-content/plugins/codebase-flattener/
   ```

2. **Add Plugin Files:**
   ```
   codebase-flattener/
   ├── codebase-flattener.php    (main plugin file)
   ├── assets/
   │   ├── admin.js
   │   └── admin.css
   └── README.md
   ```

3. **Activate Plugin:**
   - Go to WordPress Admin → Plugins
   - Find "Codebase Flattener"
   - Click "Activate"

## Usage

### Basic Workflow

1. **Navigate to Plugin:**
   - WordPress Admin → Codebase Flattener

2. **Load Repository:**
   - Enter GitHub URL (e.g., `https://github.com/owner/repo`)
   - Optionally add GitHub token for private repos
   - Click "Load Repository"

3. **Select Files:**
   - Browse the file tree
   - Check files you want to include
   - Monitor token count at bottom

4. **Fetch Content:**
   - Click "Fetch Selected Files"
   - Files are downloaded from GitHub

5. **Generate Prompt:**
   - Add your query/request
   - Customize instructions if needed
   - Click "Generate Enhanced Prompt"

6. **Copy & Use:**
   - Click "Copy to Clipboard"
   - Paste into your AI assistant

### Configuration Options

- **Branch:** Specify which branch to use (default: main)
- **File Extensions:** Comma-separated list of extensions to show
- **Ignore Folders:** Folders to exclude from file tree
- **Max Tokens:** Set your AI model's context limit
- **GitHub Token:** For private repos and higher rate limits

### GitHub API Rate Limits

- **Without Token:** 60 requests/hour
- **With Token:** 5,000 requests/hour
- **Raw Files:** No rate limit (uses raw.githubusercontent.com)

### Mobile Usage

The plugin is fully responsive and works great on mobile devices:
- Access your WordPress admin from your phone
- Navigate to Codebase Flattener
- Use the same workflow as desktop
- Three-column layout becomes single column on mobile

## Performance Notes

- **File List Loading:** ~1-2 seconds for most repos
- **File Content Fetching:** ~1-3 seconds per file
- **Large Repos:** Consider selecting only necessary files
- **Caching:** Files are cached in browser memory during session

## Tips

1. **Start Small:** Select a few key files first, then add more if needed
2. **Use Ignore List:** Add build folders, dependencies to ignore list
3. **Save Tokens:** Most AI models have token limits - watch the counter
4. **Custom Instructions:** Tailor instructions for your specific use case
5. **Private Repos:** Create a GitHub personal access token with repo scope

## Troubleshooting

### "Failed to load repository"
- Check the repository URL is correct
- For private repos, ensure token has correct permissions
- Check if the branch name is correct

### Token count too high
- Deselect some files
- Consider breaking request into multiple prompts
- Focus on specific modules/features

### Files not fetching
- Check internet connection
- GitHub might be experiencing issues
- Token might have expired or lack permissions

## Security Notes

- GitHub tokens are only stored in browser session
- No data is permanently stored on server
- All requests go directly to GitHub API
- Consider using read-only tokens for safety

## License

GPL v2 or later

## Support

For issues or feature requests, please create an issue on GitHub.
