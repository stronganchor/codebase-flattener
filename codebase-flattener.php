<?php
/**
 * Plugin Name: Codebase Flattener
 * Plugin URI: https://github.com/yourusername/codebase-flattener
 * Description: Flatten GitHub repositories into AI-ready prompts with selective file inclusion
 * Version: 1.0.0
 * Author: Your Name
 * License: GPL v2 or later
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

// Define plugin constants
define('CBF_PLUGIN_URL', plugin_dir_url(__FILE__));
define('CBF_PLUGIN_PATH', plugin_dir_path(__FILE__));

// Admin menu
add_action('admin_menu', 'cbf_add_admin_menu');
function cbf_add_admin_menu() {
    add_menu_page(
        'Codebase Flattener',
        'Codebase Flattener',
        'manage_options',
        'codebase-flattener',
        'cbf_admin_page',
        'dashicons-media-code',
        30
    );
}

// Enqueue scripts and styles
add_action('admin_enqueue_scripts', 'cbf_enqueue_admin_scripts');
function cbf_enqueue_admin_scripts($hook) {
    if ($hook !== 'toplevel_page_codebase-flattener') {
        return;
    }

    // Use file modification time as version to bust cache
    $js_version = filemtime(CBF_PLUGIN_PATH . 'assets/admin.js');
    $css_version = filemtime(CBF_PLUGIN_PATH . 'assets/admin.css');

    wp_enqueue_script('cbf-admin-js', CBF_PLUGIN_URL . 'assets/admin.js', array('jquery'), $js_version, true);
    wp_enqueue_style('cbf-admin-css', CBF_PLUGIN_URL . 'assets/admin.css', array(), $css_version);

    // Localize script with AJAX URL and nonce
    wp_localize_script('cbf-admin-js', 'cbf_ajax', array(
        'ajax_url' => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('cbf_nonce')
    ));
}

// Admin page HTML
function cbf_admin_page() {
    ?>
    <div class="wrap cbf-admin">
        <h1>Codebase Flattener</h1>

        <div class="cbf-container">
            <!-- Left Panel: Repository Input -->
            <div class="cbf-panel cbf-left">
                <h2>Repository Settings</h2>

                <div class="cbf-section">
                    <h3>Recent Repositories</h3>
                    <select id="cbf-recent-repos" size="5">
                        <!-- Populated by JS -->
                    </select>
                </div>

                <div class="cbf-section">
                    <label for="cbf-repo-url">GitHub Repository URL:</label>
                    <input type="text" id="cbf-repo-url" placeholder="https://github.com/owner/repo" />
                    <button id="cbf-load-repo" class="button button-primary">Load Repository</button>
                </div>

                <div class="cbf-section">
                    <label for="cbf-github-token">GitHub Token (optional, for private repos):</label>
                    <input type="text" id="cbf-github-token" placeholder="ghp_xxxxxxxxxxxx" />
                    <small>Increases rate limit from 60 to 5000 requests/hour</small>
                </div>

                <div class="cbf-section">
                    <label for="cbf-branch">Branch:</label>
                    <input type="text" id="cbf-branch" value="main" />
                </div>

                <div class="cbf-section">
                    <label>File Extensions to Exclude:</label>
                    <input type="text" id="cbf-extensions" value="" />
                    <small>Comma-separated list (e.g., .log,.tmp,.cache) - leave empty to include all</small>
                </div>

                <div class="cbf-section">
                    <label>Folders to Ignore:</label>
                    <input type="text" id="cbf-ignore-dirs" value="node_modules,vendor,dist,build,.git,__pycache__,venv,env,getid3,media,languages,plugin-update-checker" />
                    <small>Comma-separated list</small>
                </div>

                <div class="cbf-section">
                    <label for="cbf-max-tokens">Max Tokens (approximate):</label>
                    <input type="number" id="cbf-max-tokens" value="128000" />
                    <small>Estimated tokens: <span id="cbf-token-count">0</span></small>
                </div>
            </div>

            <!-- Middle Panel: File Selection -->
            <div class="cbf-panel cbf-middle">
                <h2>Select Files</h2>
                <div class="cbf-file-controls">
                    <button id="cbf-select-all" class="button">Select All</button>
                    <button id="cbf-deselect-all" class="button">Deselect All</button>
                    <button id="cbf-fetch-selected" class="button button-primary">Fetch Selected Files</button>
                </div>
                <div id="cbf-file-tree">
                    <!-- File tree populated by JS -->
                </div>
                <div id="cbf-loading" style="display:none;">Loading repository structure...</div>
            </div>

            <!-- Right Panel: Output -->
            <div class="cbf-panel cbf-right">
                <h2>Generated Prompt</h2>

                <div class="cbf-section">
                    <label for="cbf-custom-instructions">Custom Instructions:</label>
                    <textarea id="cbf-custom-instructions" rows="8">IMPORTANT CUSTOM INSTRUCTIONS FOR AI CHAT SESSION:
When providing code changes, indicate the relative path of the file or files that need changes.

For each file that needs changing:
- If you are only changing one line, provide just the updated line with context
- If you are changing more than one line, provide either entire updated functions or the entire updated code file

General notes:
- Provide minimal code changes. Avoid making unnecessary changes that will contribute to diff noise.
- Only add comments that are necessary for understanding the logical flow of the code.

If you are unable to complete the requested task due to lack of code context, include in your response a request to see additional code.

END CUSTOM INSTRUCTIONS</textarea>
                </div>

                <div class="cbf-section">
                    <label for="cbf-user-query">Your Query/Request:</label>
                    <textarea id="cbf-user-query" rows="4" placeholder="What would you like the AI to help you with?"></textarea>
                </div>

                <div class="cbf-section">
                    <button id="cbf-generate-prompt" class="button button-primary">Generate Enhanced Prompt</button>
                    <button id="cbf-copy-prompt" class="button">Copy to Clipboard</button>
                </div>

                <div class="cbf-section">
                    <label>Enhanced Prompt Output:</label>
                    <textarea id="cbf-output" rows="20" readonly></textarea>
                </div>
            </div>
        </div>
    </div>
    <?php
}

// AJAX handler for GitHub API requests
add_action('wp_ajax_cbf_github_api', 'cbf_handle_github_api');
function cbf_handle_github_api() {
    // Verify nonce
    if (!wp_verify_nonce($_POST['nonce'], 'cbf_nonce')) {
        wp_die('Security check failed');
    }

    $action_type = sanitize_text_field($_POST['action_type']);
    $repo_url = sanitize_text_field($_POST['repo_url']);
    $branch = sanitize_text_field($_POST['branch'] ?? 'main');
    $token = sanitize_text_field($_POST['token'] ?? '');

    // Parse GitHub URL
    preg_match('/github\.com\/([^\/]+)\/([^\/\?]+)/', $repo_url, $matches);
    if (count($matches) < 3) {
        wp_send_json_error('Invalid GitHub URL');
    }

    $owner = $matches[1];
    $repo = rtrim($matches[2], '.git');

    switch ($action_type) {
        case 'get_tree':
            $api_url = "https://api.github.com/repos/$owner/$repo/git/trees/$branch?recursive=1";
            break;

        case 'get_file':
            $path = sanitize_text_field($_POST['path']);
            // Use raw content URL to avoid rate limits
            wp_send_json_success(array(
                'download_url' => "https://raw.githubusercontent.com/$owner/$repo/$branch/$path"
            ));
            return;

        default:
            wp_send_json_error('Invalid action type');
    }

    // Make API request
    $args = array(
        'headers' => array(
            'Accept' => 'application/vnd.github.v3+json',
            'User-Agent' => 'WordPress-Codebase-Flattener'
        )
    );

    if (!empty($token)) {
        $args['headers']['Authorization'] = 'token ' . $token;
    }

    $response = wp_remote_get($api_url, $args);

    if (is_wp_error($response)) {
        wp_send_json_error($response->get_error_message());
    }

    $body = wp_remote_retrieve_body($response);
    $data = json_decode($body, true);

    if (isset($data['message'])) {
        wp_send_json_error($data['message']);
    }

    wp_send_json_success($data);
}

// Save/Load recent repos
add_action('wp_ajax_cbf_save_recent', 'cbf_save_recent_repo');
function cbf_save_recent_repo() {
    if (!wp_verify_nonce($_POST['nonce'], 'cbf_nonce')) {
        wp_die('Security check failed');
    }

    $repo_url = sanitize_text_field($_POST['repo_url']);
    $recent = get_option('cbf_recent_repos', array());

    // Remove if exists and add to front
    $recent = array_diff($recent, array($repo_url));
    array_unshift($recent, $repo_url);
    $recent = array_slice($recent, 0, 10); // Keep last 10

    update_option('cbf_recent_repos', $recent);
    wp_send_json_success($recent);
}

add_action('wp_ajax_cbf_get_recent', 'cbf_get_recent_repos');
function cbf_get_recent_repos() {
    $recent = get_option('cbf_recent_repos', array());
    wp_send_json_success($recent);
}
