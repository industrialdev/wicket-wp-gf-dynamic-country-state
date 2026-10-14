<?php
/**
 * Plugin Name: Wicket GF Dynamic Country/State
 * Description: Adds dynamic state/province dropdowns to Gravity Forms address fields
 * Version: 1.0.1
 * Plugin URI: https://wicket.io
 * Author: Wicket Inc.
 * Author URI: https://wicket.io
 * Text Domain: wicket-gf-ddd
 *
 * Forked from: gf-address-state-dropdowns
 */

if (!defined('ABSPATH')) exit;

if ( ! class_exists( 'GFForms' ) ) {
    die();
}

class GF_Dynamic_States {
    private static $instance = null;
    private $states_cache = array();

    public static function get_instance() {
        if (self::$instance == null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        // Use gform_enqueue_scripts for conditional loading
        add_action('gform_enqueue_scripts', array($this, 'maybe_enqueue_scripts'), 10, 2);
        add_action('wp_ajax_get_all_states_for_countries', array($this, 'get_all_states_for_countries'));
        add_action('wp_ajax_nopriv_get_all_states_for_countries', array($this, 'get_all_states_for_countries'));
        // Register addon when Gravity Forms is fully loaded.
        add_action('gform_loaded', array($this,'register_addon'), 5);

        // Add comprehensive logging hooks for form validation debugging
        $this->add_debugging_hooks();
    }

    public function register_addon() {
        // States cache loads lazily inside the AJAX path: the all-countries payload is multi-MB
        // and a per-request load showed up as slow page loads on Pantheon

        // Check if GFAddOn class exists
        if (!class_exists('GFAddOn')) {
            return;
        }

        // Check if addon class file exists
        $addon_file = plugin_dir_path(__FILE__) . 'includes/class-gf-dynamic-states-addon.php';
        if (!file_exists($addon_file)) {
            return;
        }

        try {
            require_once('includes/class-gf-dynamic-states-addon.php');
            GFAddOn::register('GFDynamicStatesAddOn');
        } catch (Exception $e) {
            error_log('GF State Dropdowns - Exception registering addon: ' . $e->getMessage());
        }
    }

    public function maybe_load_states_cache() {
        $cache = get_transient('gf_all_states_cache');

        if (false === $cache) {
            $cache = array();
            $vendor_path = plugin_dir_path(__FILE__) . 'vendor/rinvex/countries/resources/';

            // Get all JSON files in divisions directory
            $files = glob($vendor_path . 'divisions/*.json');

            foreach ($files as $file) {
                $country_code = strtoupper(basename($file, '.json'));
                $divisions_data = json_decode(file_get_contents($file), true);

                if (!empty($divisions_data)) {
                    $states = array();
                    foreach ($divisions_data as $code => $division) {
                        $states[$code] = $division['name'] ?? $division;
                    }
                    $cache[$country_code] = $states;
                }
            }

            set_transient('gf_all_states_cache', $cache, WEEK_IN_SECONDS);
        }

        $this->states_cache = $cache;
    }

    // Renamed from enqueue_scripts and made conditional
    public function maybe_enqueue_scripts($form, $is_ajax) {
        // Check if the form object is valid and contains an address field
        if (!is_array($form) || !class_exists('GFAPI') || empty(GFAPI::get_fields_by_type($form, array('address')))) {
            return; // Don't enqueue if no address field is found
        }

        wp_enqueue_style(
            'gf-dynamic-states',
            plugins_url('css/style.css', __FILE__),
            array('gform_basic'),
            filemtime(plugin_dir_path(__FILE__) . 'css/style.css')
        );

        wp_enqueue_script(
            'gf-dynamic-states',
            plugins_url('js/dynamic-states.js', __FILE__),
            array('jquery', 'gform_gravityforms'),
            filemtime(plugin_dir_path(__FILE__) . 'js/dynamic-states.js'),
            true
        );

        // Get form-specific settings from GFAddOn
        $form_settings = $this->get_form_settings($form);

        // Get enabled status from form settings
        $enabled = false;
        if (isset($form_settings['enable_dynamic_states'])) {
            // Cast to bool and ensure it's truly boolean for JavaScript
            $enabled = !empty($form_settings['enable_dynamic_states']);
        }

        // Get country format from form settings
        $country_format = 'name'; // default
        if (isset($form_settings['country_format'])) {
            $country_format = $form_settings['country_format'];
        }

        wp_localize_script('gf-dynamic-states', 'gfDynamicStates', array(
            'ajaxurl' => admin_url('admin-ajax.php'),
            'nonce'   => wp_create_nonce('gf_dynamic_states'),
            'enabled' => $enabled, // This will be converted to a proper boolean in JavaScript
            'countryFormat' => $country_format,
            'formId'  => $form['id']
        ));
    }

    private function get_form_settings($form) {
        if (!class_exists('GFDynamicStatesAddOn')) {
            return array('country_format' => 'code');
        }

        $addon = GFDynamicStatesAddOn::get_instance();
        $settings = $addon->get_form_settings($form);

        if (empty($settings)) {
            return array('country_format' => 'code');
        }

        return $settings;
    }

    private function get_country_code($country_name_or_code) {
        if (strlen($country_name_or_code) > 2) {
            // Is a country name
            try {
                // Convert country name to code
                $countries = \Rinvex\Country\CountryLoader::countries();
                foreach ($countries as $code => $country) {
                    if (strcasecmp($country['name'], $country_name_or_code) === 0) {
                        return $code;
                    }
                }
            } catch (\Exception $e) {
                return $country_name_or_code;
            }
        } else {
            // Is already a code
            return $country_name_or_code;
        }
    }

    // New function to fetch states for multiple countries in one AJAX call.
    public function get_all_states_for_countries() {
        check_ajax_referer('gf_dynamic_states', 'nonce');

        $countries = isset($_POST['countries']) ? $_POST['countries'] : array();
        $format    = isset($_POST['format']) ? $_POST['format'] : 'name';
        if (!is_array($countries)) {
            wp_send_json_error('Invalid countries parameter.');
        }

        // Sanitize each country input
        $countries = array_map('sanitize_text_field', $countries);

        $result = array();
        try {
            require_once plugin_dir_path(__FILE__) . 'vendor/autoload.php';
            foreach ($countries as $country_input) {
                $country_code = $this->get_country_code($country_input);
                if($format == 'code') {
                    $result[$country_code] = $this->get_states_by_country($country_code);
                } else {
                    $result[$country_input] = $this->get_states_by_country($country_code);
                }
            }
            wp_send_json_success($result);
        } catch (Exception $e) {
            wp_send_json_error($e->getMessage());
        }
    }

    private function get_states_by_country($country_code) {
        $country_code = strtoupper($country_code);

        if (empty($this->states_cache)) {
            $cache = get_transient('gf_all_states_cache');
            $this->states_cache = is_array($cache) ? $cache : array();
        }

        if (empty($this->states_cache)) {
            $this->maybe_load_states_cache();
        }

        return $this->states_cache[$country_code] ?? array();
    }

    /**
     * Helper function to log messages using WC logger
     */
    private function log($message, $level = 'info') {
        return; // Disable logging for now

        if (function_exists('wc_get_logger')) {
            $logger = wc_get_logger();
            $logger->log($level, $message, array('source' => 'gf-dynamic-states'));
        } else {
            error_log('GF Dynamic States: ' . $message);
        }
    }

    /**
     * Add comprehensive debugging hooks for form validation
     */
    private function add_debugging_hooks() {
        return; // Disable logging for now

        // Pre-submission hooks
        add_action('gform_pre_submission', array($this, 'log_pre_submission'), 10, 1);
        add_filter('gform_validation', array($this, 'log_validation'), 10, 1);
        add_filter('gform_field_validation', array($this, 'log_field_validation'), 10, 4);

        // Submission hooks
        add_action('gform_after_submission', array($this, 'log_after_submission'), 10, 2);
        add_action('gform_post_submission', array($this, 'log_post_submission'), 10, 2);

        // Field value hooks
        add_filter('gform_save_field_value', array($this, 'log_save_field_value'), 10, 4);
        add_filter('gform_get_input_value', array($this, 'log_get_input_value'), 10, 4);

        // Address field specific hooks
        add_filter('gform_address_display_format', array($this, 'log_address_display'), 10, 1);

        // Generic hooks for debugging
        add_action('gform_validation_message', array($this, 'log_validation_message'), 10, 2);

        // Additional hooks for deep debugging
        add_filter('gform_field_value', array($this, 'log_field_value'), 10, 3);
        add_filter('gform_pre_render', array($this, 'log_pre_render'), 10, 1);
        add_action('wp_footer', array($this, 'log_form_state'), 10);

        // Specific validation hooks for address fields
        add_filter('gform_validation_' . get_class(), array($this, 'custom_address_validation'), 10, 1);
        add_action('gform_field_standard_settings', array($this, 'log_field_settings'), 10, 2);
    }

    public function log_pre_submission($form) {
        $this->log("PRE SUBMISSION - Form ID: {$form['id']}", 'debug');

        // Log all submitted values for address fields
        foreach ($form['fields'] as $field) {
            if ($field->type === 'address') {
                $this->log("Address Field {$field->id} inputs:", 'debug');
                foreach ($field->inputs as $input) {
                    if ($input !== null) {
                        $value = rgpost("input_{$input['id']}");
                        $this->log("  Input {$input['id']} ({$input['label']}): " . var_export($value, true), 'debug');
                    }
                }
            }
        }
    }

    public function log_validation($validation_result) {
        $form = $validation_result['form'];
        $is_valid = $validation_result['is_valid'];

        $this->log("VALIDATION - Form ID: {$form['id']}, Is Valid: " . ($is_valid ? 'TRUE' : 'FALSE'), 'debug');

        // Log validation status for each address field
        foreach ($form['fields'] as $field) {
            if ($field->type === 'address') {
                $this->log("Address Field {$field->id} validation:", 'debug');
                $this->log("  Required: " . ($field->isRequired ? 'YES' : 'NO'), 'debug');
                $this->log("  Failed validation: " . ($field->failed_validation ? 'YES' : 'NO'), 'debug');
                $this->log("  Validation message: " . ($field->validation_message ?: 'none'), 'debug');

                // Log individual input values
                foreach ($field->inputs as $input) {
                    if ($input !== null) {
                        $value = rgpost("input_{$input['id']}");
                        $this->log("  Input {$input['id']} ({$input['label']}): " . var_export($value, true), 'debug');
                    }
                }
            }
        }

        return $validation_result;
    }

    public function log_field_validation($result, $value, $form, $field) {
        if ($field->type === 'address') {
            $this->log("FIELD VALIDATION - Field ID: {$field->id}", 'debug');
            $this->log("  Field Type: {$field->type}", 'debug');
            $this->log("  Value: " . var_export($value, true), 'debug');
            $this->log("  Result is_valid: " . ($result['is_valid'] ? 'TRUE' : 'FALSE'), 'debug');
            $this->log("  Result message: " . ($result['message'] ?: 'none'), 'debug');

            // Log individual address inputs
            foreach ($field->inputs as $input) {
                if ($input !== null) {
                    $input_value = rgar($value, $input['id']);
                    $this->log("  Address Input {$input['id']} ({$input['label']}): " . var_export($input_value, true), 'debug');
                }
            }
        }

        return $result;
    }

    public function log_after_submission($entry, $form) {
        $this->log("AFTER SUBMISSION - Form ID: {$form['id']}, Entry ID: {$entry['id']}", 'debug');
    }

    public function log_post_submission($entry, $form) {
        $this->log("POST SUBMISSION - Form ID: {$form['id']}, Entry ID: {$entry['id']}", 'debug');
    }

    public function log_save_field_value($value, $lead, $field, $form) {
        if ($field->type === 'address') {
            $this->log("SAVE FIELD VALUE - Field ID: {$field->id}", 'debug');
            $this->log("  Value: " . var_export($value, true), 'debug');
        }
        return $value;
    }

    public function log_get_input_value($value, $lead, $field, $input_id) {
        if ($field->type === 'address') {
            $this->log("GET INPUT VALUE - Field ID: {$field->id}, Input ID: {$input_id}", 'debug');
            $this->log("  Value: " . var_export($value, true), 'debug');
        }
        return $value;
    }

    public function log_address_display($format) {
        $this->log("ADDRESS DISPLAY FORMAT: " . var_export($format, true), 'debug');
        return $format;
    }

    public function log_validation_message($message, $form) {
        $this->log("VALIDATION MESSAGE - Form ID: {$form['id']}", 'debug');
        $this->log("  Message: " . $message, 'debug');
        return $message;
    }

    public function log_field_value($value, $field, $form) {
        if ($field->type === 'address') {
            $this->log("FIELD VALUE - Field ID: {$field->id}", 'debug');
            $this->log("  Value: " . var_export($value, true), 'debug');
        }
        return $value;
    }

    public function log_pre_render($form) {
        $this->log("PRE RENDER - Form ID: {$form['id']}", 'debug');

        // Log current values of address fields
        foreach ($form['fields'] as $field) {
            if ($field->type === 'address') {
                $this->log("Address Field {$field->id} pre-render state:", 'debug');
                $this->log("  Required: " . ($field->isRequired ? 'YES' : 'NO'), 'debug');

                foreach ($field->inputs as $input) {
                    if ($input !== null) {
                        $default_value = rgar($input, 'defaultValue');
                        $this->log("  Input {$input['id']} ({$input['label']}) default: " . var_export($default_value, true), 'debug');
                    }
                }
            }
        }

        return $form;
    }

    public function log_form_state() {
        // Only log if this is a form page with address fields
        if (isset($_POST['gform_submit']) || isset($_GET['gf_page'])) {
            $this->log("FORM STATE LOG - Current page has Gravity Form activity", 'debug');

            // Log POST data for address fields
            foreach ($_POST as $key => $value) {
                if (strpos($key, 'input_') === 0) {
                    $this->log("POST Data - {$key}: " . var_export($value, true), 'debug');
                }
            }
        }
    }

    public function custom_address_validation($validation_result) {
        $this->log("CUSTOM ADDRESS VALIDATION - Running custom validation", 'debug');
        return $validation_result;
    }

    public function log_field_settings($position, $form_id) {
        if ($position == 25) { // Standard position for field settings
            $this->log("FIELD SETTINGS - Loading field settings for form {$form_id}", 'debug');
        }
    }

    // Add a diagnostic page to troubleshoot blank settings
    public function add_diagnostic_page() {
        // Only if we're on the settings page and it's a blank screen
        if (is_admin() &&
            current_user_can('manage_options') &&
            isset($_GET['subview']) &&
            $_GET['subview'] == 'gf-state-dropdowns' &&
            isset($_GET['page']) &&
            $_GET['page'] == 'gf_edit_forms' &&
            isset($_GET['id']) &&
            isset($_GET['diagnostic']) &&
            $_GET['diagnostic'] == '1') {

            // Add diagnostic HTML
            ?>
            <!DOCTYPE html>
            <html>
            <head>
                <title>GF State Dropdowns Diagnostic</title>
                <style>
                    body { font-family: sans-serif; padding: 20px; line-height: 1.6; }
                    .success { color: green; }
                    .error { color: red; }
                    pre { background: #f5f5f5; padding: 10px; overflow: auto; }
                </style>
            </head>
            <body>
                <h1>GF State Dropdowns Diagnostic</h1>
                <p>This page helps diagnose why the settings page is blank.</p>

                <h2>Plugin Information</h2>
                <ul>
                    <li>Addon Slug: gf-state-dropdowns</li>
                    <li>URL Parameters: <?php echo esc_html(print_r($_GET, true)); ?></li>
                </ul>

                <h2>Gravity Forms Information</h2>
                <ul>
                    <li>Gravity Forms Active: <?php echo class_exists('GFForms') ? '<span class="success">Yes</span>' : '<span class="error">No</span>'; ?></li>
                    <li>GFAddOn Class Available: <?php echo class_exists('GFAddOn') ? '<span class="success">Yes</span>' : '<span class="error">No</span>'; ?></li>
                    <li>Gravity Forms Version: <?php echo defined('GF_MIN_WP_VERSION') ? esc_html(GF_MIN_WP_VERSION) : 'Unknown'; ?></li>
                </ul>

                <h2>Form Information</h2>
                <?php
                $form_id = absint($_GET['id']);
                try {
                    $form = GFAPI::get_form($form_id);
                    echo '<p class="success">Form loaded successfully</p>';
                    echo '<pre>' . esc_html(print_r($form, true)) . '</pre>';
                } catch (Exception $e) {
                    echo '<p class="error">Error loading form: ' . esc_html($e->getMessage()) . '</p>';
                }
                ?>

                <h2>Addon Information</h2>
                <?php
                if (class_exists('GFDynamicStatesAddOn')) {
                    $addon = GFDynamicStatesAddOn::get_instance();
                    echo '<p class="success">Addon class loaded successfully</p>';
                    echo '<pre>' . esc_html(print_r($addon, true)) . '</pre>';

                    // Try to get form settings
                    if (isset($form) && $form) {
                        $settings = $addon->get_form_settings($form);
                        echo '<h2>Form Settings</h2>';
                        echo '<pre>' . esc_html(print_r($settings, true)) . '</pre>';
                    }
                } else {
                    echo '<p class="error">Addon class not loaded</p>';
                }
                ?>
            </body>
            </html>
            <?php
            exit;
        }
    }
}

// Add action to run diagnostic if needed
add_action('admin_init', function() {
    $instance = GF_Dynamic_States::get_instance();
    $instance->add_diagnostic_page();
}, 999);

GF_Dynamic_States::get_instance();
