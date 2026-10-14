/**
 * Admin JavaScript for GF State Dropdowns Settings
 */
(function($) {
    'use strict';
    
    $(document).ready(function() {
        console.log('GF State Dropdowns admin script loaded');
        
        // Log settings page loaded
        if (typeof gf_state_dropdowns !== 'undefined') {
            console.log('GF State Dropdowns settings page initialized');
        }
        
        // Fix for any hidden settings
        setTimeout(function() {
            $('.gform_settings_form input, .gform_settings_form select').css('visibility', 'visible');
            $('.gform_settings_form').css('visibility', 'visible');
        }, 300);
    });
    
})(jQuery); 