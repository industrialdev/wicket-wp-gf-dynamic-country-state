<?php

if (!class_exists('GFForms')) {
    die();
}

class GFDynamicStatesAddOn extends GFAddOn {
    protected $_version = '1.0';
    protected $_min_gravityforms_version = '2.5';
    protected $_slug = 'gf-state-dropdowns';
    protected $_path = 'gf-address-state-dropdowns/gf-address-state-dropdowns.php';
    protected $_full_path = __FILE__;
    protected $_title = 'State/Province Dropdowns for Gravity Forms';
    protected $_short_title = 'State Dropdowns';
    protected $_capabilities = 'gravityforms_edit_forms';
    protected $_capabilities_settings_page = 'gravityforms_edit_forms';
    protected $_capabilities_form_settings = 'gravityforms_edit_forms';

    private static $_instance = null;

    public static function get_instance() {
        if (self::$_instance == null) {
            self::$_instance = new self();
        }
        return self::$_instance;
    }

    public function init() {
        parent::init();
        error_log('GFDynamicStatesAddOn init() called');
        add_filter('gform_address_types', array($this, 'add_dynamic_address_type'));
        add_filter('gform_address_field_settings', array($this, 'address_settings'));
        add_filter('gform_pre_render', array($this, 'pre_render_form'));
        add_filter('gform_pre_validation', array($this, 'pre_render_form'));

        // Make sure Form Settings get registered
        add_filter('gform_form_settings_menu', array($this, 'add_form_settings_menu'), 10, 2);

        // Add debugging action to log when addon registration completes
        add_action('admin_init', array($this, 'debug_addon_registration'));
    }

    // Add our tab to the form settings menu
    public function add_form_settings_menu($menu_items, $form_id) {
        $menu_items[] = array(
            'name' => $this->_slug,
            'label' => $this->get_short_title(),
            'capabilities' => $this->_capabilities_form_settings,
        );
        error_log('GF State Dropdowns - Added form settings menu item');
        return $menu_items;
    }

    // Override this to ensure scripts are loaded on the settings page
    public function scripts() {
        $scripts = array(
            array(
                'handle'    => 'gf_state_dropdowns_admin',
                'src'       => plugins_url('js/admin.js', dirname(__FILE__)),
                'version'   => $this->_version,
                'deps'      => array('jquery'),
                'callback'  => array($this, 'localize_scripts'),
                'in_footer' => true,
                'enqueue'   => array(
                    array(
                        'admin_page' => array('form_settings'),
                        'tab'        => $this->_slug
                    ),
                )
            ),
        );

        return array_merge(parent::scripts(), $scripts);
    }

    public function localize_scripts() {
        wp_localize_script('gf_state_dropdowns_admin', 'gf_state_dropdowns', array(
            'ajaxurl' => admin_url('admin-ajax.php'),
            'nonce'   => wp_create_nonce('gf_state_dropdowns_admin')
        ));
    }

    public function debug_addon_registration() {
        // Log to WordPress debug log
        $current_screen = get_current_screen();
        error_log('GF State Dropdowns - Admin Init - Current Screen: ' . ($current_screen ? $current_screen->id : 'none'));

        // Check if we're on our settings page
        if (isset($_GET['subview']) && $_GET['subview'] == 'gf-state-dropdowns' &&
            isset($_GET['page']) && $_GET['page'] == 'gf_edit_forms') {
            error_log('GF State Dropdowns - On settings page');

            // Log the form ID
            if (isset($_GET['id'])) {
                error_log('GF State Dropdowns - Form ID: ' . $_GET['id']);

                // Forcibly try to get form settings
                try {
                    $form = GFAPI::get_form($_GET['id']);
                    if ($form) {
                        error_log('GF State Dropdowns - Form loaded successfully');
                        $this->form_settings_fields($form);
                    }
                } catch (Exception $e) {
                    error_log('GF State Dropdowns - Error loading form: ' . $e->getMessage());
                }
            }
        }
    }

    // Override this method to return your custom icon.
    public function get_menu_icon() {
        return 'dashicons dashicons-admin-site';
    }

    public function add_dynamic_address_type($address_types) {
        $address_types['dynamic'] = array(
            'label' => esc_html__('Dynamic States/Provinces', 'wicket-wp-gf-dynamic-country-state'),
            'zip_label' => esc_html__('ZIP / Postal Code', 'wicket-gf-ddd'),
            'state_label' => esc_html__('State / Province / Region', 'wicket-gf-ddd'),
            'country_label' => esc_html__('Country', 'wicket-gf-ddd'),
            'country_type' => 'select',
            'states' => array()
        );
        return $address_types;
    }

    public function address_settings($settings) {
        $settings['use_dynamic_states'] = array(
            'name' => 'use_dynamic_states',
            'label' => esc_html__('Use Dynamic States', 'wicket-gf-ddd'),
            'type' => 'checkbox',
            'choices' => array(
                array(
                    'label' => esc_html__('Enable dynamic state/province dropdowns', 'wicket-gf-ddd'),
                    'name' => 'use_dynamic_states',
                    'default_value' => 0
                )
            )
        );
        return $settings;
    }

    public function form_settings_fields($form) {
        error_log('GF State Dropdowns - form_settings_fields() called with form ID: ' . ($form ? $form['id'] : 'unknown'));

        try {
            return array(
                array(
                    'title' => esc_html__('Dynamic States Settings', 'wicket-gf-ddd'),
                    'fields' => array(
                        array(
                            'label' => esc_html__('Enable State/Province Dropdowns', 'wicket-gf-ddd'),
                            'type' => 'checkbox',
                            'name' => 'enable_dynamic_states',
                            'tooltip' => esc_html__('Enable dynamic state/province dropdowns for address fields', 'wicket-gf-ddd'),
                            'choices' => array(
                                array(
                                    'label' => esc_html__('Enable', 'wicket-gf-ddd'),
                                    'name' => 'enable_dynamic_states'
                                )
                            )
                        ),
                        array(
                            'label' => esc_html__('Country Format', 'wicket-gf-ddd'),
                            'type' => 'radio',
                            'name' => 'country_format',
                            'tooltip' => esc_html__('Choose whether to use country names or codes', 'wicket-gf-ddd'),
                            'default_value' => 'name',
                            'choices' => array(
                                array(
                                    'label' => esc_html__('Country Names (e.g. Canada) - Gravity Forms Default', 'wicket-gf-ddd'),
                                    'value' => 'name'
                                ),
                                array(
                                    'label' => esc_html__('Country Codes (e.g. CA)', 'wicket-gf-ddd'),
                                    'value' => 'code'
                                )
                            )
                        )
                    )
                )
            );
        } catch (\Exception $e) {
            error_log('GF State Dropdowns - Error in form_settings_fields: ' . $e->getMessage());
            // Return a minimal settings array to prevent blank screen
            return array(
                array(
                    'title' => 'Dynamic States Settings',
                    'fields' => array(
                        array(
                            'label' => 'Error Loading Settings',
                            'type' => 'html',
                            'name' => 'error_message',
                            'html' => '<div class="error notice"><p>There was an error loading the settings. Please check the WordPress error log.</p></div>'
                        )
                    )
                )
            );
        }
    }

    public function pre_render_form($form) {
        // Get form settings
        $settings = $this->get_form_settings($form);

        // Log form settings to debug
        $settings_json = json_encode($settings);
        error_log("GF State Dropdowns - Pre-render form {$form['id']} - Settings: {$settings_json}");

        // Only proceed if settings exist
        if (empty($settings)) {
            return $form;
        }

        // Add form settings to form object for access in maybe_enqueue_scripts
        $form[$this->_slug] = $settings;

        // Properly check if dynamic states are enabled (handle various formats)
        $is_enabled = false;
        if (isset($settings['enable_dynamic_states'])) {
            $value = $settings['enable_dynamic_states'];
            // Handle various possible formats (string '1', boolean true, etc.)
            $is_enabled = !empty($value) && $value !== 'false' && $value !== '0';

            // Debug the value and how it's being interpreted
            error_log("GF State Dropdowns - enable_dynamic_states value: " .
                      var_export($value, true) . " (type: " . gettype($value) .
                      ") - Interpreted as: " . ($is_enabled ? "enabled" : "disabled"));
        }

        // Check if dynamic states are enabled
        if ($is_enabled) {
            // Append a CSS class for JavaScript to detect
            $form['cssClass'] = isset($form['cssClass']) ? $form['cssClass'] . ' gf-dynamic-states-enabled' : 'gf-dynamic-states-enabled';

            // Add country format class if specified
            if (!empty($settings['country_format'])) {
                $form['cssClass'] .= ' gf-dynamic-states-format-' . $settings['country_format'];
            }

            error_log("GF State Dropdowns - Enabled for form {$form['id']} - Format: " .
                      (!empty($settings['country_format']) ? $settings['country_format'] : 'name'));
        } else {
            error_log("GF State Dropdowns - Disabled for form {$form['id']}");
        }

        return $form;
    }
}
