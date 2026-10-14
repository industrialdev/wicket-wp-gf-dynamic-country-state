// Debug mode - enable in the browser console: localStorage.setItem('gfasDebug','1') then reload
const WT_GFAS_DEBUG_MODE = !!(window.localStorage && window.localStorage.getItem('gfasDebug'));

// Run this script immediately before jQuery loads to show loading animations right away
document.addEventListener('DOMContentLoaded', function() {
  // IMPORTANT: First attempt to immediately remove the body class in case it was added previously
  // This needs to happen before any other code to prevent the spinners from being shown at all
  if (document.body) {
    document.body.classList.remove('gf-dynamic-states-feature-loading');
  }

  // Global helper to check for disabled state that can be called immediately
  function isFeatureDisabledInitial() {
    if (!window.gfDynamicStates || typeof window.gfDynamicStates.enabled === 'undefined') {
      // If settings aren't available yet, don't apply loading
      return true; // Assume disabled until we know for sure
    }

    var enabled = window.gfDynamicStates.enabled;

    // Handle various formats properly
    if (typeof enabled === 'boolean') {
      return enabled === false;
    } else if (typeof enabled === 'string') {
      // Empty string, "0", "false" should be treated as disabled
      return enabled === "" ||
             enabled === "0" ||
             enabled.toLowerCase() === "false";
    } else if (typeof enabled === 'number') {
      return enabled === 0;
    }

    // If unknown type, don't apply loading until jQuery ready
    return true;
  }

  // Function to run immediately to apply loading state to address fields
  function markFieldsAsLoading() {
    // Check if the feature is enabled first via global variable
    if (isFeatureDisabledInitial()) {
      // Since we're disabling the feature, ensure we REMOVE any existing loading classes
      var fields = document.querySelectorAll('.ginput_address_country, .ginput_address_state');
      for (var i = 0; i < fields.length; i++) {
        // Remove loading class if it exists
        fields[i].classList.remove('loading');
        fields[i].classList.remove('initialized');
      }

      // Remove the body class that controls loading indicators
      if (document.body) {
        document.body.classList.remove('gf-dynamic-states-feature-loading');
      }

      wt_gfas_debug('GF State Dropdowns: Feature disabled for this form. Removing loading indicators.');
      return; // Exit early if disabled
    }

    // Add the body class that controls loading indicators
    if (document.body) {
      document.body.classList.add('gf-dynamic-states-feature-loading');
    }

    var fields = document.querySelectorAll('.ginput_address_country, .ginput_address_state');
    for (var i = 0; i < fields.length; i++) {
      fields[i].classList.add('loading');
    }
  }

  // IMPORTANT: Run this first to force the body class update before painting
  markFieldsAsLoading();

  // Also run when DOM is interactive but before full load
  document.addEventListener('DOMContentLoaded', function() {
    // Run it again to ensure proper state
    markFieldsAsLoading();

    // Also do an extra check after a short delay in case the settings weren't available initially
    setTimeout(function() {
      markFieldsAsLoading();
    }, 10);
  });
});

// Debug logging function - only logs when debug mode is enabled
function wt_gfas_debug() {
  if (WT_GFAS_DEBUG_MODE && window.console && console.log) {
    console.log.apply(console, arguments);
  }
}

jQuery(document).ready(function($) {
  // Helper function to check if feature is disabled
  function isFeatureDisabled() {
    if (!gfDynamicStates || typeof gfDynamicStates.enabled === 'undefined') {
      // If no settings, assume enabled
      return false;
    }

    // Handle various formats properly
    if (typeof gfDynamicStates.enabled === 'boolean') {
      return gfDynamicStates.enabled === false;
    } else if (typeof gfDynamicStates.enabled === 'string') {
      // Empty string, "0", "false" should be treated as disabled
      return gfDynamicStates.enabled === "" ||
             gfDynamicStates.enabled === "0" ||
             gfDynamicStates.enabled.toLowerCase() === "false";
    } else if (typeof gfDynamicStates.enabled === 'number') {
      return gfDynamicStates.enabled === 0;
    }

    // If unknown type, assume enabled
    return false;
  }

  // EARLY CHECK: Exit if the feature is disabled for this form
  if (isFeatureDisabled()) {
    wt_gfas_debug('GF State Dropdowns: Feature disabled for this form. Skipping initialization.');
    wt_gfas_debug('Disabled check - Value type:', typeof gfDynamicStates.enabled, 'Value:', gfDynamicStates.enabled);

    // IMPORTANT: Force manual removal of all related classes and styles
    $('.ginput_address_country, .ginput_address_state').removeClass('loading initialized');
    $('.ginput_address_country, .ginput_address_state').css({
      'position': 'static',
      'background-image': 'none',
      'opacity': '1'
    });

    // Directly update CSS to hide the pseudo elements
    $('<style id="gf-dynamic-states-disabled-style">')
      .text(`
        .ginput_address_country::before, .ginput_address_country::after,
        .ginput_address_state::before, .ginput_address_state::after {
          display: none !important;
          content: none !important;
          animation: none !important;
          border: none !important;
          background: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
        }
      `)
      .appendTo('head');

    // Remove the body class that controls loading indicators
    $('body').removeClass('gf-dynamic-states-feature-loading');

    // Remove any classes that might have been added
    $('form').removeClass('gf-dynamic-states-enabled gf-dynamic-states-format-code gf-dynamic-states-format-name');

    return; // Exit the script completely
  }

  // If we got here, the feature is enabled, ensure body class is set
  $('body').addClass('gf-dynamic-states-feature-loading');

  // Log initialization
  wt_gfas_debug("GF State Dropdowns initializing for form", gfDynamicStates ? gfDynamicStates.formId : 'unknown');
  wt_gfas_debug("Settings:", gfDynamicStates);

  var resizeTimer; // Timer for debouncing resize
  var listeningToResize = false; // Flag to ensure listener is only added once
  var hasAlreadyFetchedStates = false; // Flag to track if we've already fetched states
  var originalStateValues = {}; // Store original state values by field ID
  var ajaxInProgress = false; // Track if AJAX is currently in progress

  // Global variables for state management
  var statesCache = {}; // Cache of states by country
  var addressFieldPages = {}; // Store which page each address field is on
  var currentFormPage = 1; // Default to page 1
  var countriesToFetch = []; // Global list of countries to fetch states for
  wt_gfas_debug("Initial currentFormPage set to default:", currentFormPage);

  // Helper function to show loading indicator
  function showLoading($container) {
    if ($container && $container.length) {
      $container.addClass('loading');
      $container.removeClass('initialized'); // Ensure initialized class is removed
      $container.attr('data-loading-since', String(Date.now()));
      if (WT_GFAS_DEBUG_MODE) {
        console.log('[GFAS] showLoading on', $container.attr('class'), new Error().stack);
      }

      // Don't disable the field during loading, as it can interfere with validation
      var $field = $container.find('input, select');
      if ($field.length) {
        // Only disable if explicitly needed for UX, but document it
        // $field.prop('disabled', true);
        wt_gfas_debug("Showing loading for field:", $field.attr('id'), "keeping field enabled");
      }
    }
  }

  // Helper function to hide loading indicator
  function hideLoading($container, force) {
    if ($container && $container.length) {
      $container.removeAttr('data-loading-since');
      // Mark as initialized first, then remove loading
      $container.addClass('initialized');
      // Short delay to ensure transitions look smooth
      setTimeout(function() {
        $container.removeClass('loading');
        // Ensure the field is enabled for form validation
        var $stateField = $container.find('input, select');
        if ($stateField.length) {
          $stateField.prop('disabled', false);
          wt_gfas_debug("Ensured field is enabled for validation:", $stateField.attr('id'));
        }
      }, force ? 0 : 50);
    }
  }

  // Function to check if an element is actually visible in the DOM
  function isElementVisible(el) {
    if (!el) return false;

    var $el = $(el);
    var fieldId = $el.attr('id') || 'unnamed';

    // Find which page the field is on
    var $page = $el.closest('.gform_page');
    if ($page.length > 0) {
      var pageId = $page.attr('id');
      if (pageId) {
        // Extract page number from id like "gform_page_2_1" -> gets "1"
        var pageNumber = parseInt(pageId.split('_').pop(), 10);
        // Only consider visible if it's on the current page
        var isVisible = pageNumber === currentFormPage;
        wt_gfas_debug(`Field ${fieldId} is on page ${pageNumber}, current page is ${currentFormPage}, visible: ${isVisible}`);
        return isVisible;
      }
    }

    // If we're on a multi-page form but the field isn't in a page container,
    // it might be a global field or on page 1
    if ($('.gform_page').length > 0) {
      // For multi-page forms, we need to be careful about visibility
      if (currentFormPage === 1) {
        wt_gfas_debug(`Field ${fieldId} is not in a page container, current page is 1, considering visible`);
        return true;
      } else {
        // If we're beyond page 1, and the field isn't in a page container,
        // it's probably not on this page
        wt_gfas_debug(`Field ${fieldId} is not in a page container, but we're on page ${currentFormPage}, considering invisible`);
        return false;
      }
    }

    // For single-page forms or fields outside the page structure
    wt_gfas_debug(`Field ${fieldId} is considered visible (default case)`);
    return true;
  }

  // Immediate check for pre-selected countries on page load
  function handlePreSelectedCountries() {
    wt_gfas_debug("Checking for pre-selected countries on page load");

    $('.ginput_address_country select').each(function() {
      var $countrySelect = $(this);
      var country = $countrySelect.val();
      var fieldId = $countrySelect.attr('id');

      // Only process fields on the current page
      var fieldPage = addressFieldPages[fieldId] || 1;
      if (fieldPage !== currentFormPage) {
        return true; // Skip fields not on current page
      }

      if (country) {
        wt_gfas_debug("Found pre-selected country on page load:", country, "for field:", fieldId);

        var $stateContainer = $countrySelect.closest('.ginput_complex').find('.ginput_address_state');
        var $stateField = $stateContainer.find('input, select');

        if ($stateContainer.length && $stateField.length) {
          var initialStateValue = $stateField.val() || '';

          if (statesCache[country]) {
            // We have states cached for this country
            wt_gfas_debug("States available for pre-selected country:", country, "updating state field");
            $stateContainer.data('initial-value', initialStateValue);
            updateStateField($countrySelect, statesCache[country]);
          } else {
            // We don't have states cached yet, mark for update when cache is available
            wt_gfas_debug("No cached states yet for pre-selected country:", country, "will update after cache loads");
          }
        }
      }
    });
  }

  // Find and store which page each address field is on
  function detectAddressFieldPages() {
    $('.ginput_address_country').each(function() {
      var $container = $(this);
      var $field = $container.find('select');
      var fieldId = $field.attr('id');

      if (fieldId) {
        // Find which page this field is on
        var $page = $container.closest('.gform_page');
        if ($page.length) {
          var pageId = $page.attr('id');
          if (pageId) {
            // Extract page number from id like "gform_page_2_1" -> gets "1"
            var pageNumber = pageId.split('_').pop();
            addressFieldPages[fieldId] = parseInt(pageNumber, 10);
            wt_gfas_debug(`Address field ${fieldId} is on page ${pageNumber}`);
          }
        } else {
          // If not in a page, assume it's page 1
          addressFieldPages[fieldId] = 1;
          wt_gfas_debug(`Address field ${fieldId} is not in a page container, assuming page 1`);
        }
      }
    });

    // Also check the current form page
    var $visiblePage = $('.gform_page:visible');
    if ($visiblePage.length) {
      var pageId = $visiblePage.attr('id');
      if (pageId) {
        var pageNumber = parseInt(pageId.split('_').pop(), 10);
        currentFormPage = pageNumber;
        wt_gfas_debug(`Detected current visible page: ${currentFormPage}`);
      }
    }
  }

  // Save original values for all state fields
  function saveOriginalStateValues() {
    $('.ginput_address_state input, .ginput_address_state select').each(function() {
      var $field = $(this);
      var fieldId = $field.attr('id');
      if (fieldId && $field.val()) {
        originalStateValues[fieldId] = $field.val();
        wt_gfas_debug(`Saved original state value for ${fieldId}: ${$field.val()}`);
      }
    });
  }

  // Function to get the current form page
  function getCurrentFormPage() {
    if (typeof currentFormPage !== 'undefined' && currentFormPage > 0) {
      return currentFormPage;
    }

    var urlParams = new URLSearchParams(window.location.search);
    var pageParam = urlParams.get('gf_page');
    if (pageParam) {
      return parseInt(pageParam, 10);
    }

    var $visiblePage = $('.gform_page:visible');
    if ($visiblePage.length) {
      var pageId = $visiblePage.attr('id');
      if (pageId) {
        var pageParts = pageId.split('_');
        if (pageParts.length > 0) {
          return parseInt(pageParts[pageParts.length - 1], 10);
        }
      }
    }

    return 1;
  }

  // Function to initialize visible address fields
  function initializeVisibleAddressFields() {
    var currentPage = getCurrentFormPage();
    wt_gfas_debug("Initializing visible address fields on current page: " + currentPage);

    $('.ginput_address_country select').each(function() {
      var $countrySelect = $(this);
      var fieldId = $countrySelect.attr('id');
      var $container = $countrySelect.closest('.ginput_address_country');

      var fieldPage = addressFieldPages[fieldId] || 1;
      if (fieldPage === currentPage && isElementVisible(this)) {
        wt_gfas_debug("Initializing visible field " + fieldId);

        if (!$container.hasClass('initialized')) {
          $container.addClass('initialized');
          hideLoading($container);
        }
      }
    });
  }

  // Function to update state field
  function updateStateField($countrySelect, states) {
    wt_gfas_debug("Updating state field with", Object.keys(states).length, "states");
        wt_gfas_debug("GF DYNAMIC STATES: updateStateField called with " + Object.keys(states).length + " states");

    states = states || {};
    var $stateContainer = $countrySelect.closest('.ginput_complex').find('.ginput_address_state');

    wt_gfas_debug("GF DYNAMIC STATES: State container found:", $stateContainer.length > 0);
    if (!$stateContainer.length) {
      wt_gfas_debug("GF DYNAMIC STATES: ERROR - No state container found!");
    }
    if (!$stateContainer.length) {
      wt_gfas_debug("No state container found in updateStateField");
      return;
    }
    showLoading($stateContainer);
    var $stateField = $stateContainer.find('input, select');
    if (!$stateField.length) {
      wt_gfas_debug("No state field found in updateStateField");
      hideLoading($stateContainer);
      return;
    }
    wt_gfas_debug("State field attributes before replacement:", {
      'name': $stateField.attr('name'),
      'id': $stateField.attr('id'),
      'aria-required': $stateField.attr('aria-required'),
      'required': $stateField.prop('required'),
      'class': $stateField.attr('class')
    });

    var initialValue = $stateContainer.data('initial-value') || '';
    if (Object.keys(states).length > 0) {
      var $select = $('<select>', {
        name: $stateField.attr('name'),
        id: $stateField.attr('id'),
        'aria-required': $stateField.attr('aria-required'),
        'aria-describedby': $stateField.attr('aria-describedby'),
        'data-required': $stateField.attr('data-required'),
        'required': $stateField.attr('required'),
        class: $stateField.attr('class'),
        tabindex: $stateField.attr('tabindex')
      });

      var originalClasses = $stateField.attr('class') || '';
      if (originalClasses.indexOf('gfield_contains_required') === -1) {
        var $parentField = $stateField.closest('.gfield');
        if ($parentField.hasClass('gfield_contains_required')) {
          $select.addClass('gfield_contains_required');
        }
      }

      $select.append($('<option>', {
        value: '',
        text: '-- Select State --'
      }));

      var valueFound = false;
      $.each(states, function(code, name) {
        var $option = $('<option>', {
          value: code,
          text: name
        });

        if (!valueFound && initialValue && (initialValue === code || initialValue === name)) {
          wt_gfas_debug("Using initial value:", name);
          $option.prop('selected', true);
          valueFound = true;
        }

        $select.append($option);
      });

      if (valueFound) {
        var selectedOption = $select.find('option[selected]');
        if (selectedOption.length) {
          var selectedValue = selectedOption.val();
          $select.val(selectedValue);

          $select.find('option').removeAttr('selected');
          selectedOption.attr('selected', 'selected');

          wt_gfas_debug("Set select value to:", selectedValue);
        }
      }

      var $fieldContainer = $stateContainer.closest('.ginput_complex, .gfield');
      if ($fieldContainer.hasClass('gfield_contains_required') ||
          $stateField.attr('aria-required') === 'true' ||
          $stateField.prop('required') ||
          $stateField.attr('data-required')) {
        $select.attr('aria-required', 'true');
        $select.prop('required', true);
        wt_gfas_debug("Marked replacement state select as required");
      }

      wt_gfas_debug("Replacing state field with dropdown containing", Object.keys(states).length, "states");
      $stateField.replaceWith($select);
      var $newStateField = $stateContainer.find('select');

      // Add change handler to track state selection
      if ($newStateField.length) {
        $newStateField.off('change.stateTracking').on('change.stateTracking', function() {
          var selectedState = $(this).val();
          var selectedText = $(this).find('option:selected').text();
          wt_gfas_debug("GF DYNAMIC STATES: State selected - Value:", selectedState, "Text:", selectedText);
          wt_gfas_debug("State selected:", selectedState, selectedText);

          // Immediately trigger persistence
          setTimeout(function() {
            ensureMultiStepPersistence();
          }, 100);
        });
        wt_gfas_debug("GF DYNAMIC STATES: State dropdown created with " + $newStateField.find('option').length + " options");
      }

      try {
        if ($newStateField.length) {
          var selectedValue = $newStateField.val();
          if (selectedValue) {
            wt_gfas_debug("Ensuring selected value is properly set:", selectedValue);
            $newStateField.find('option[value="' + selectedValue + '"]').prop('selected', true).attr('selected', 'selected');
            $newStateField.trigger('input').trigger('change').trigger('blur');
          } else {
            $newStateField.trigger('input').trigger('change');
          }
        } else {
          wt_gfas_debug("New state field (select) not found after replacement");
        }
      } catch (e) {
        // A listener throwing on these events used to skip the hide timers below (WWID-2777)
        console.error('GF Dynamic States: listener error after state select swap', e);
      }
    } else {
      var $originalInput = $stateContainer.data('original-input');

      if (!$originalInput) {
        wt_gfas_debug("No original input found, creating a new one");
        $originalInput = $('<input>', {
          type: 'text',
          name: $stateField.attr('name'),
          id: $stateField.attr('id'),
          'aria-required': $stateField.attr('aria-required'),
          'aria-describedby': $stateField.attr('aria-describedby'),
          'data-required': $stateField.attr('data-required'),
          'required': $stateField.attr('required'),
          class: $stateField.attr('class'),
          tabindex: $stateField.attr('tabindex')
        });

        var $parentGField = $stateContainer.closest('.gfield');
        if ($parentGField.length && $parentGField.hasClass('gfield_contains_required')) {
          $originalInput.attr('aria-required', 'true');
          $originalInput.prop('required', true);
          $originalInput.addClass('gfield_required');
          wt_gfas_debug("Marked replacement input as required");
        }
      } else {
        $originalInput = $originalInput.clone();
      }

      $originalInput.val('');
      wt_gfas_debug("Replacing state field with empty input");

      $stateField.replaceWith($originalInput);

      try {
        $originalInput.trigger('input').trigger('change');
      } catch (e) {
        // A listener throwing on these events used to skip the hide timers below (WWID-2777)
        console.error('GF Dynamic States: listener error after state input swap', e);
      }

      var fieldId = $originalInput.attr('id');
      if (fieldId) {
        var idParts = fieldId.split('_');
        if (idParts.length >= 2) {
          var formNumber = idParts[1];

          setTimeout(function() {
            if (typeof jQuery !== 'undefined' && jQuery.fn.trigger) {
              jQuery(document).trigger('gform_post_render', [formNumber, currentFormPage]);
              wt_gfas_debug("Triggered gform_post_render for input field on form", formNumber);
            }

            var $form = $originalInput.closest('form');
            if ($form.length) {
              $form.trigger('change');
              wt_gfas_debug("Triggered form change for input field validation");
            }
          }, 50);
        }
      }
    }

    $stateContainer.removeData('initial-value');

    setTimeout(function() {
      hideLoading($stateContainer);
    }, 300);
  }

  // Function to initialize forms with state data
  function initializeForms() {
    wt_gfas_debug("Initializing forms with received state data - page:", currentFormPage);

    var isPage1 = currentFormPage === 1;

    var $allCountrySelects = $('.ginput_address_country select');
    if (!$allCountrySelects || $allCountrySelects.length === 0) {
      return;
    }

    $allCountrySelects.each(function() {
      var $countrySelect = $(this);
      var fieldId = $countrySelect.attr('id');

      if (fieldId && addressFieldPages[fieldId] && addressFieldPages[fieldId] !== currentFormPage) {
        wt_gfas_debug(`Skipping country ${fieldId} - not on current page ${currentFormPage}`);
        return true;
      }

      if (!isElementVisible(this)) {
        wt_gfas_debug(`Skipping country ${fieldId} - not visible`);
        return true;
      }

      var country = $countrySelect.val();
      wt_gfas_debug("Processing country select with value:", country);

      var $stateContainer = $countrySelect.closest('.ginput_complex').find('.ginput_address_state');

      if (!$stateContainer.length) {
        wt_gfas_debug("No state container found for this country select");
        return true;
      }

      var $stateField = $stateContainer.find('input, select');

      if (!$stateField.length) {
        wt_gfas_debug("No state field found in container");
        return true;
      }

      if (!$stateContainer.data('original-input')) {
        $stateContainer.data('original-input', $stateField.clone());
      }

      var initialStateValue = $stateField.val();
      var stateFieldId = $stateField.attr('id');

      if (stateFieldId && originalStateValues[stateFieldId]) {
        initialStateValue = originalStateValues[stateFieldId];
        wt_gfas_debug(`Using stored original value for ${stateFieldId}: ${initialStateValue}`);
      }

      wt_gfas_debug("Initial state value:", initialStateValue);

      if (country && statesCache[country]) {
        wt_gfas_debug("Country has states in cache, updating state field for pre-selected country:", country);

        if (Object.keys(statesCache[country]).length > 0) {
          $stateContainer.data('initial-value', initialStateValue);
          updateStateField($countrySelect, statesCache[country]);
        } else {
          wt_gfas_debug("Country has no states, ensuring text input is shown");
          updateStateField($countrySelect, {});
        }
      } else if (country && !statesCache[country]) {
        wt_gfas_debug("Country selected but states not cached yet, will update when cache is populated");
      } else if (!country) {
        wt_gfas_debug("No country selected, ensuring state field is in default state");
        if ($stateField.is('select')) {
          wt_gfas_debug("Initializing standard state select (if needed, though updateStateField handles creation)");
          hideLoading($stateContainer);
          $stateContainer.addClass('initialized');
        }
      }
    });

    $('.ginput_address_country select').prop('disabled', false);
    wt_gfas_debug("All country selects re-enabled after form initialization.");
  }

  // Function to prefetch states
  function prefetchAllStates(countryFormat) {
    wt_gfas_debug("Countries to fetch for global prefetch:", countriesToFetch, "Using format:", countryFormat);

    if (countriesToFetch.length <= 0) {
      wt_gfas_debug("No countries to fetch for global prefetch");
      initializeForms();
      return;
    }

    if (ajaxInProgress) {
      wt_gfas_debug("AJAX already in progress, skipping global prefetch");
      return;
    }

    ajaxInProgress = true;
    wt_gfas_debug("Starting AJAX request for states (global prefetch) - setting ajaxInProgress flag");

    var data = {
      action: 'get_all_states_for_countries',
      nonce: gfDynamicStates.nonce,
      countries: countriesToFetch,
      format: countryFormat
    };
    wt_gfas_debug("AJAX data being sent (from prefetchAllStates):", data);

    jQuery.ajax({
      url: gfDynamicStates.ajaxurl,
      type: 'POST',
      data: data,
      dataType: 'json',
      success: function(response) {
        wt_gfas_debug("AJAX response received (global prefetch):", response.success ? 'success' : 'error');
        wt_gfas_debug("GF DYNAMIC STATES: AJAX prefetch success:", response.success);

        if (response.success) {
          statesCache = response.data;
          var countriesCount = Object.keys(statesCache).length;
          wt_gfas_debug("States cached for countries (global prefetch):", countriesCount);
          wt_gfas_debug("GF DYNAMIC STATES: Cached states for " + countriesCount + " countries");
          wt_gfas_debug("GF DYNAMIC STATES: Available countries:", Object.keys(statesCache));

          $('.ginput_address_country select').each(function() {
            var $countrySelect = $(this);
            var country = $countrySelect.val();
            var fieldId = $countrySelect.attr('id');

            var fieldPage = addressFieldPages[fieldId] || 1;
            if (fieldPage !== currentFormPage) {
              return true;
            }

            if (country && statesCache[country]) {
              var $stateContainer = $countrySelect.closest('.ginput_complex').find('.ginput_address_state');
              var $stateField = $stateContainer.find('input, select');

              if ($stateContainer.length && $stateField.length) {
                var initialStateValue = $stateField.val() || '';

                var needsUpdate = false;

                if (Object.keys(statesCache[country]).length > 0) {
                  if ($stateField.is('input')) {
                    needsUpdate = true;
                    wt_gfas_debug("Post-cache: Converting input to select for pre-selected country:", country);
                  } else if ($stateField.is('select')) {
                    var currentOptions = $stateField.find('option').length;
                    var expectedOptions = Object.keys(statesCache[country]).length + 1;
                    if (currentOptions !== expectedOptions) {
                      needsUpdate = true;
                      wt_gfas_debug("Post-cache: Updating select options for pre-selected country:", country);
                    }
                  }
                } else {
                  if ($stateField.is('select')) {
                    needsUpdate = true;
                    wt_gfas_debug("Post-cache: Converting select to input for country with no states:", country);
                  }
                }

                if (needsUpdate) {
                  $stateContainer.data('initial-value', initialStateValue);
                  updateStateField($countrySelect, statesCache[country] || {});
                }
              }
            }
          });

          initializeForms();
        } else {
          wt_gfas_debug("Failed to fetch states (global prefetch):", response.data);
          initializeForms();
        }
      },
      error: function() {
        wt_gfas_debug("AJAX error occurred (global prefetch)");
        ajaxInProgress = false;
        // Clear spinners first: initializeForms has nothing to hide when the cache is empty
        $('.ginput_address_country, .ginput_address_state').each(function() {
          hideLoading($(this), true);
        });
        try {
          initializeForms();
        } catch (e) {
          console.error('GF Dynamic States: initializeForms error after prefetch failure', e);
        }
      },
      complete: function() {
        wt_gfas_debug("AJAX request complete (global prefetch) - clearing ajaxInProgress flag");
        ajaxInProgress = false;
      }
    });
  }

  // Function to apply country change handlers
  function applyCountryChangeHandler() {
    wt_gfas_debug("Applying global country change handlers");
    var $allCountrySelects = $('.ginput_address_country select');

    $allCountrySelects.off('change.dynamicStates');

    $allCountrySelects.on('change.dynamicStates', function(e) {
      var $countrySelect = $(this);
      var fieldId = $countrySelect.attr('id');

      wt_gfas_debug("GF DYNAMIC STATES: Country change event triggered for field:", fieldId);

      var fieldPage = addressFieldPages[fieldId] || 1;
      if (fieldPage !== currentFormPage) {
        wt_gfas_debug(`Skipping handler for ${fieldId} - not on current page ${currentFormPage}`);
        return;
      }

      var country = $countrySelect.val();
      wt_gfas_debug("Country changed to (global handler):", country);
              wt_gfas_debug("GF DYNAMIC STATES: Country change detected - " + country);

      var $stateContainer = $countrySelect.closest('.ginput_complex').find('.ginput_address_state');

      if (!$stateContainer.length) {
        wt_gfas_debug("No state container found for country change (global handler)");
        return;
      }

      showLoading($stateContainer);
      var $stateField = $stateContainer.find('input, select');

      if (!$stateField.length) {
        wt_gfas_debug("No state field found for country change (global handler)");
        hideLoading($stateContainer);
        return;
      }

      var stateValue = $stateField.val();
      var stateFieldId = $stateField.attr('id');
      if (stateFieldId && stateValue) {
        originalStateValues[stateFieldId] = stateValue;
        wt_gfas_debug(`Saving value for ${stateFieldId} (global handler): ${stateValue}`);
      }

      wt_gfas_debug("Updating state field for new country (global handler):", country);

      $stateContainer.data('initial-value', '');

      if (country && statesCache[country]) {
        wt_gfas_debug("Found", Object.keys(statesCache[country]).length, "states for", country, "(global handler)");
        wt_gfas_debug("GF DYNAMIC STATES: Found " + Object.keys(statesCache[country]).length + " states for " + country);
        updateStateField($countrySelect, statesCache[country]);
      } else {
        wt_gfas_debug("No states found for country (global handler):", country);
        wt_gfas_debug("GF DYNAMIC STATES: NO STATES FOUND for country: " + country);
        wt_gfas_debug("GF DYNAMIC STATES: Available countries in cache:", Object.keys(statesCache));
        updateStateField($countrySelect, {});
      }
    });
  }

  $('form').each(function(){
    var $form = $(this);

    var isGravityForm = $form.hasClass('gform_wrapper') ||
                        $form.find('.gform_wrapper').length > 0 ||
                        $form.attr('id') && $form.attr('id').indexOf('gform_') === 0;

    wt_gfas_debug("Form detected:", $form.attr('id') || 'unnamed form', "Is Gravity Form:", isGravityForm);

    if (!($form.hasClass('gf-dynamic-states-enabled') ||
         (isGravityForm && ($form.find('.ginput_address_country').length > 0 ||
                           $form.find('.ginput_address_state').length > 0)))) {
        wt_gfas_debug("Skipping form - not enabled or no address fields");
        return true;
    }

    detectAddressFieldPages();

    saveOriginalStateValues();

    var $countrySelectsThisForm = $form.find('.ginput_address_country select');

    wt_gfas_debug("Found country selects in this form:", $countrySelectsThisForm.length);

    if ($countrySelectsThisForm.length === 0) {
        wt_gfas_debug("No country selects found in this form, skipping specific processing for it.");
        return true;
    }

    var hasVisibleCountrySelects = false;

    if (currentFormPage === 1) {
      $countrySelectsThisForm.each(function() {
        var fieldId = $(this).attr('id');
        if (fieldId && (!addressFieldPages[fieldId] || addressFieldPages[fieldId] === 1)) {
          wt_gfas_debug(`Field ${fieldId} should be visible on page 1`);
          hasVisibleCountrySelects = true;
          return false;
        }
      });
    }

    if (!hasVisibleCountrySelects) {
      $countrySelectsThisForm.each(function() {
        if (isElementVisible(this)) {
          var fieldId = $(this).attr('id') || 'unnamed';
          wt_gfas_debug(`Found visible field through DOM check: ${fieldId}`);
          hasVisibleCountrySelects = true;
          return false;
        }
      });
    }

    var shouldFetchStates = !hasAlreadyFetchedStates && (hasVisibleCountrySelects || currentFormPage === 1);

    wt_gfas_debug("Should fetch states (form-specific check):", shouldFetchStates, "Has visible selects:", hasVisibleCountrySelects, "On page 1:", currentFormPage === 1);

    var countryFormatThisForm = 'name';
    if ($form.hasClass('gf-dynamic-states-format-code')) {
        countryFormatThisForm = 'code';
    }
    wt_gfas_debug("Form-specific country format (if needed elsewhere):", countryFormatThisForm);

    if (!shouldFetchStates) {
        wt_gfas_debug("Skipping initial processing for this form - using cached data or no visible fields right now");
        if (hasVisibleCountrySelects) {
            initializeVisibleAddressFields();
            initializeForms();
        }
    } else {
      $countrySelectsThisForm.filter(':visible').prop('disabled', true);
      $countrySelectsThisForm.filter(':visible').closest('.ginput_address_country').addClass('loading');
    }
  });

  $(document).on('gform_page_loaded', function(event, form_id, current_page) {
    if (form_id && current_page) {
      wt_gfas_debug("Gravity Form page loaded event: form_id=", form_id, "current_page=", current_page);

      currentFormPage = parseInt(current_page, 10);
      wt_gfas_debug("Form page changed to:", currentFormPage);

      $('.ginput_address_country, .ginput_address_state').each(function() {
        var $container = $(this);
        var $page = $container.closest('.gform_page');
        var isOnCurrentPage = false;

        if ($page.length) {
          var pageId = $page.attr('id');
          if (pageId) {
            var pageParts = pageId.split('_');
            if (pageParts.length >= 4) {
              var pageNum = parseInt(pageParts[pageParts.length - 1], 10);
              isOnCurrentPage = pageNum === currentFormPage;
            }
          }
        } else {
          isOnCurrentPage = currentFormPage === 1;
        }

        if (isOnCurrentPage) {
          showLoading($container);

          if ($container.hasClass('ginput_address_country')) {
            var $countrySelect = $container.find('select');
            var country = $countrySelect.val();

            if (country && statesCache[country]) {
              var $stateContainer = $countrySelect.closest('.ginput_complex').find('.ginput_address_state');
              var $stateField = $stateContainer.find('input, select');

              if ($stateContainer.length && $stateField.length) {
                var initialStateValue = $stateField.val() || '';
                wt_gfas_debug("Page navigation: Found pre-selected country", country, "updating state field");

                $stateContainer.data('initial-value', initialStateValue);
                updateStateField($countrySelect, statesCache[country]);
              }
            }
          }

          setTimeout(function() {
            var $select = $container.find('select');
            if ($select.length) {
              $select.trigger('change');
            }

            setTimeout(function() {
              hideLoading($container);
            }, 300);
          }, 100);
        }
      });
    }
  });

  document.addEventListener('gform_page_loaded', function(event) {
    if (event.detail && event.detail.form_id && event.detail.current_page) {
      wt_gfas_debug("Native gform_page_loaded event fired:", event.detail);

      currentFormPage = parseInt(event.detail.current_page, 10);
      wt_gfas_debug("Updated current page to:", currentFormPage);

      $('.ginput_address_country, .ginput_address_state').each(function() {
        var $container = $(this);
        var $page = $container.closest('.gform_page');

        var isOnCurrentPage = false;
        if ($page.length) {
          var pageNum = parseInt($page.attr('id').split('_').pop(), 10);
          isOnCurrentPage = pageNum === currentFormPage;
        } else {
          isOnCurrentPage = currentFormPage === 1;
        }

        if (isOnCurrentPage) {
          showLoading($container);

          if ($container.hasClass('ginput_address_country')) {
            var $countrySelect = $container.find('select');
            var country = $countrySelect.val();

            if (country && statesCache[country]) {
              var $stateContainer = $countrySelect.closest('.ginput_complex').find('.ginput_address_state');
              var $stateField = $stateContainer.find('input, select');

              if ($stateContainer.length && $stateField.length) {
                var initialStateValue = $stateField.val() || '';
                wt_gfas_debug("Native page event: Found pre-selected country", country, "updating state field");

                $stateContainer.data('initial-value', initialStateValue);
                updateStateField($countrySelect, statesCache[country]);
                return;
              }
            }
          }

          setTimeout(function() {
            var $select = $container.find('select');
            if ($select.length) {
              $select.trigger('change');
            }

            setTimeout(function() {
              hideLoading($container);
            }, 200);
          }, 100);
        }
      });
    }
  });

  // Recurring failsafe: one-shot timers left spinners stuck when a change happened after they had fired
  setInterval(function() {
    $('.ginput_address_country, .ginput_address_state').each(function() {
      var $container = $(this);
      var $field = $container.find('select, input');

      // Any .loading container older than 3s is orphaned: its own hide timers have fired or been skipped
      if ($container.hasClass('loading')) {
        var since = parseInt($container.attr('data-loading-since') || '0', 10);
        if (since && Date.now() - since > 3000) {
          wt_gfas_debug("Failsafe: forcing stale loading field to initialized:", $field.attr('id') || 'unnamed');
          hideLoading($container, true);
        }
        return;
      }

      // Containers with neither class paint the pre-load spinner via :not(.initialized) forever
      if (!$container.hasClass('initialized') && $field.length) {
        var ready = $field.is('input') || ($field.is('select') && $field.find('option').length > 1);
        if (ready && !$field.prop('disabled')) {
          $container.addClass('initialized');
        }
      }
    });
  }, 1000);

  $(document).on('gform_page_loaded', function(event, form_id, current_page) {
    setTimeout(function() {
      $('.ginput_address_country select, .ginput_address_state select').each(function() {
        var $select = $(this);
        var $container = $select.closest('.ginput_address_country, .ginput_address_state');

        if ($select.find('option').length > 1 || $select.val() !== '') {
          if (!$container.hasClass('initialized')) {
            wt_gfas_debug("Post-page load: Marking field as initialized:", $select.attr('id'));
            $container.addClass('initialized');
            hideLoading($container);
          }
        }
      });
    }, 50);
  });

  setTimeout(function() {
    wt_gfas_debug("Immediate post-ready check for initialized country fields");
    $('.ginput_address_country, .ginput_address_state').each(function() {
      var $container = $(this);
      var $select = $container.find('select');

      if ($container.hasClass('loading')) {
        if (($select.find('option').length > 1 && $select.val() !== '') || $select.is('input')) {
          wt_gfas_debug("Immediate fix: Found initialized field still showing loading: " + ($select.attr('id') || 'unnamed'));
          $container.addClass('initialized');
          hideLoading($container);
        }
      }
    });
  }, 50);

  function initPlugin() {
    wt_gfas_debug("Applying country change handlers");
    applyCountryChangeHandler();

    var allPossibleCountries = [];
    $('.ginput_address_country select').each(function() {
      var countryOptions = $(this).find('option').map(function() {
        return $(this).val();
      }).get();
      countryOptions.forEach(function(country) {
        if (country && allPossibleCountries.indexOf(country) === -1) {
          allPossibleCountries.push(country);
        }
      });
    });
    wt_gfas_debug("All possible countries found in dropdowns:", allPossibleCountries.length, allPossibleCountries);

    countriesToFetch = allPossibleCountries;
    wt_gfas_debug("Using all possible countries for initial prefetch:", countriesToFetch);

    var globalCountryFormat = 'name';
    if ($('form').filter(function() {
        return ($(this).hasClass('gf-dynamic-states-enabled') ||
                ($(this).attr('id') && $(this).attr('id').startsWith('gform_'))) &&
               $(this).hasClass('gf-dynamic-states-format-code');
    }).length > 0) {
        globalCountryFormat = 'code';
    }

    wt_gfas_debug("Global country format for prefetch determined as:", globalCountryFormat);

    prefetchAllStates(globalCountryFormat);

    handlePreSelectedCountries();
  }

  initPlugin();

  setTimeout(function() {
    wt_gfas_debug("Additional check for pre-selected countries after page load");
    handlePreSelectedCountries();
  }, 250);

  // Pre-submit validation check - runs before Gravity Forms validation
  $(document).on('click', 'input[type="submit"], button[type="submit"]', function(e) {
    var $form = $(this).closest('form');

    if ($form.find('.ginput_address_state').length > 0) {
      wt_gfas_debug("Pre-submit: Ensuring all address fields are ready for validation");
      wt_gfas_debug("GF DYNAMIC STATES: Pre-submit check running");

      $form.find('.ginput_address_country, .ginput_address_state').each(function() {
        var $container = $(this);
        var $field = $container.find('input, select');

        if ($container.hasClass('loading') || !$container.hasClass('initialized')) {
          wt_gfas_debug("Pre-submit: Finalizing field state:", $field.attr('id') || 'unnamed');

          // Force completion regardless of AJAX state
          if (ajaxInProgress) {
            ajaxInProgress = false;
          }

          hideLoading($container, true);
        }

        // Ensure field is enabled and value is preserved
        if ($field.length) {
          $field.prop('disabled', false);
          var fieldValue = $field.val();
          if (fieldValue) {
            wt_gfas_debug("GF DYNAMIC STATES: Pre-submit field " + $field.attr('id') + " has value: " + fieldValue);
            // Aggressively ensure the value is set in DOM
            $field.val(fieldValue);
            $field.attr('value', fieldValue);
            if ($field.is('select')) {
              $field.find('option[value="' + fieldValue + '"]').prop('selected', true).attr('selected', 'selected');
            }
          }
        }
      });
    }
  });

  $(document).on('submit', 'form', function(e) {
    var $form = $(this);

    if ($form.find('.ginput_address_state select').length > 0) {
      wt_gfas_debug("Form submission detected, ensuring values are properly set");
      wt_gfas_debug("GF DYNAMIC STATES: Form submission intercepted");

      // First, ensure any stuck loading states are cleared
      $form.find('.ginput_address_country, .ginput_address_state').each(function() {
        var $container = $(this);
        if ($container.hasClass('loading')) {
          wt_gfas_debug("Form submission: Clearing stuck loading state on:", $container.attr('class'));
          hideLoading($container, true);
        }
      });

                    // NUCLEAR OPTION: Manually ensure state field values are in the form data
       // Check both visible fields AND stored values from previous steps
       var allStateFields = $form.find('.ginput_address_state select, .ginput_address_state input');

       allStateFields.each(function() {
         var $select = $(this);
         var fieldId = $select.attr('id');
         var inputName = $select.attr('name');
         var currentValue = $select.val();

         wt_gfas_debug("GF DYNAMIC STATES: Pre-submit state field check:");
         wt_gfas_debug("  Field ID:", fieldId);
         wt_gfas_debug("  Input Name:", inputName);
         wt_gfas_debug("  Current Value:", currentValue);
         wt_gfas_debug("  Field exists:", $select.length > 0);
         wt_gfas_debug("  Field visible:", $select.is(':visible'));
         wt_gfas_debug("  Selected option:", $select.find('option:selected').text());

         if (currentValue && inputName) {
           wt_gfas_debug("GF DYNAMIC STATES: Nuclear option - ensuring " + inputName + " = " + currentValue);

           // Remove any existing hidden input for this field
           $form.find('input[type="hidden"][name="' + inputName + '"]').remove();

           // Add a hidden input to guarantee the value is submitted
           $('<input>')
             .attr('type', 'hidden')
             .attr('name', inputName)
             .attr('value', currentValue)
             .appendTo($form);

           wt_gfas_debug("GF DYNAMIC STATES: Added hidden input for " + inputName + " with value " + currentValue);
         } else {
           wt_gfas_debug("GF DYNAMIC STATES: Nuclear option FAILED - field " + inputName + " has no value: " + currentValue);
         }
       });

      $form.find('.ginput_address_state select').each(function() {
        var $select = $(this);
        var currentValue = $select.val();

        // Ensure the field is enabled
        $select.prop('disabled', false);

        if (currentValue) {
          $select.find('option[value="' + currentValue + '"]').prop('selected', true).attr('selected', 'selected');

          // CRITICAL: Aggressive multi-step persistence for form submission
          $select.trigger('input');
          $select.trigger('change');
          $select.trigger('blur');
          $select.trigger('focus');

                    // Try to notify Gravity Forms with error handling
          try {
            if (typeof gform !== 'undefined' && gform.doAction) {
              gform.doAction('gform_input_change', $select, $form);
            }
          } catch (e) {
            wt_gfas_debug("GF DYNAMIC STATES: Error calling gform.doAction:", e.message);
          }

          wt_gfas_debug("CRITICAL: Ensured field", $select.attr('id'), "has value:", currentValue, "with aggressive persistence");
        } else {
          wt_gfas_debug("Field", $select.attr('id'), "has no value but is enabled for validation");
        }
      });
    }
  });

  // Multi-step form value persistence
  function ensureMultiStepPersistence() {
    wt_gfas_debug("Ensuring multi-step form value persistence for state fields");

    $('.ginput_address_state select, .ginput_address_state input').each(function() {
      var $field = $(this);
      var fieldValue = $field.val();

      if (!fieldValue) {
        return;
      }

      var $form = $field.closest('form');
      var inputName = $field.attr('name');
      var $backup = inputName && $form.length ? $form.find('input[name="backup_' + inputName + '"]') : $();
      var alreadySelected = !$field.is('select') || !!($field.find('option[value="' + fieldValue + '"]').prop('selected'));

      // Announcing an already-stable field re-fires this function through the
      // stateTracking change handler: an unbounded event loop that starves the
      // main thread (~10k events/s measured on WWID-2777) and holds the spinner.
      if (alreadySelected && $backup.length && $backup.val() === fieldValue) {
        return;
      }

      if (!alreadySelected) {
        $field.val(fieldValue);
        if ($field.is('select')) {
          $field.find('option[value="' + fieldValue + '"]').prop('selected', true).attr('selected', 'selected');
        }
      }

      if ($backup.length) {
        $backup.val(fieldValue);
      } else if (inputName && $form.length) {
        $('<input>')
          .attr('type', 'hidden')
          .attr('name', 'backup_' + inputName)
          .attr('value', fieldValue)
          .appendTo($form);
      }

      wt_gfas_debug("Multi-step: persisted " + inputName + " = " + fieldValue);

      // Trigger basic events (avoid problematic GF functions)
      $field.trigger('input');
      $field.trigger('change');
    });
  }

    // Call persistence function when moving between form steps
  $(document).on('click', '.gform_next_button, .gform_previous_button', function() {
    wt_gfas_debug("Multi-step navigation detected, ensuring state field persistence");
    wt_gfas_debug("GF DYNAMIC STATES: Form navigation - checking state fields before step change");

    var $form = $(this).closest('form');

    $('.ginput_address_state select, .ginput_address_state input').each(function() {
      var $field = $(this);
      var fieldValue = $field.val();
      var inputName = $field.attr('name');

      wt_gfas_debug("  Field " + $field.attr('id') + " value before navigation: " + fieldValue);

      if (fieldValue && inputName) {
        wt_gfas_debug("GF DYNAMIC STATES: Storing field value for multi-step: " + inputName + " = " + fieldValue);

        // Store in localStorage as additional backup
        try {
          localStorage.setItem('gf_dynamic_states_' + inputName, fieldValue);
          wt_gfas_debug("GF DYNAMIC STATES: Stored in localStorage: gf_dynamic_states_" + inputName + " = " + fieldValue);
        } catch (e) {
          wt_gfas_debug("GF DYNAMIC STATES: localStorage not available");
        }

        // Ensure backup field exists
        var backupName = 'backup_' + inputName;
        $form.find('input[name="' + backupName + '"]').remove();
        $('<input>')
          .attr('type', 'hidden')
          .attr('name', backupName)
          .attr('value', fieldValue)
          .appendTo($form);

        wt_gfas_debug("GF DYNAMIC STATES: Created backup field: " + backupName);
      }
    });

    ensureMultiStepPersistence();
  });

  // Call persistence function when page loads (for returning to a step)
  $(document).on('gform_page_loaded', function(event, form_id, current_page) {
    setTimeout(function() {
      wt_gfas_debug("Page loaded event: ensuring state field persistence for form " + form_id + ", page " + current_page);
      ensureMultiStepPersistence();
    }, 100);
  });

  // Persistence runs event-driven (state change, step navigation, page load).
  // A periodic re-run here fed the unbounded event loop removed with WWID-2777.

  // Override updateStateField to include multi-step persistence
  var originalUpdateStateField = updateStateField;
  updateStateField = function($countrySelect, states) {
    try {
      return originalUpdateStateField.call(this, $countrySelect, states);
    } finally {
      setTimeout(function() {
        ensureMultiStepPersistence();
      }, 100);
    }
  };
});

/**
 * To check:
 * https://gf-address-enhanced.webaware.net.au/
 */
