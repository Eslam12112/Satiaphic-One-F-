(function($) {

    var SessionStorage = function(pfx) {
        this.pfx = pfx;
    };

    SessionStorage.prototype.browserSupport = function() {
        // this is taken from modernizr.
        var mod = 'modernizr';
        try {
            localStorage.setItem(mod, mod);
            localStorage.removeItem(mod);
            return true;
        } catch (e) {
            return false;
        }
    };

    // BE-modified: store in localStorage
    SessionStorage.prototype.setItem = function(key, value) {
        return localStorage.setItem(this.pfx + ':' + key, JSON.stringify(value));
    };

    // BE-modified: get from localStorage
    SessionStorage.prototype.getItem = function(key) {
        try {
            var v = localStorage.getItem(this.pfx + ':' + key);
            if (v !== null) {
                v = JSON.parse(v);
            }
            return v;
        } catch (e) {
            return null;
        }
    };

    SessionStorage.prototype.getFirst = function(keys) {
        // Get value from all possible keys.
        var value = null;
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            value = prefillStore.getItem(key);
            if (value) {
                return value;
            }
        }
        return null;
    };

    var prefillStore = new SessionStorage('webform_prefill')


    var FormValList = function($e, name_attr) {
        this.$e = $e;
        this.name_attr = name_attr || 'name';
        this.name = $e.attr(this.name_attr);
        this.cache_key = this.pfxMap(this.name);
    };

    FormValList.prototype.getVal = function() {
        var $e = this.$e;
        var type = $e.attr('type');
        if (type == 'checkbox' || type == 'radio') {
            $e = $e.closest('form').find('input:' + type + '[' + this.name_attr + '="' + this.name + '"]:checked');
        }
        var val = $e.val() || [];
        return (val.constructor === Array) ? val : [val];
    };

    FormValList.prototype.getAllByName = function() {
        return this.$e.closest('form')
            .find('[' + this.name_attr + '="' + this.name + '"]')
            .filter('input:checkbox, input:radio, select[multiple]');
    };

    FormValList.prototype.pfxMap = function(x) {
        return 'l:' + x;
    }

    var FormValSingle = function($e, name_attr) {
        this.$e = $e;
        this.name_attr = name_attr || 'name';
        this.name = $e.attr(this.name_attr);
        this.cache_key = this.pfxMap(this.name);
    };

    FormValSingle.prototype.getVal = function() {
        return this.$e.val();
    };

    FormValSingle.prototype.getAllByName = function() {
        return this.$e.closest('form')
            .find('[' + this.name_attr + '="' + this.name + '"]')
            .not('input:checkbox, input:radio, select[multiple]');
    };

    FormValSingle.prototype.pfxMap = function(x) {
        return 's:' + x;
    }

    Drupal.behaviors.webform_prefill = {};

    Drupal.behaviors.webform_prefill.elementFactory = function($e, name_attr) {
        name_attr = name_attr || 'data-form-key';
        var type = $e.attr('type');
        if (type == 'checkbox' || type == 'radio' || $e.is('select[multiple]')) {
            return new FormValList($e, name_attr);
        }
        return new FormValSingle($e, name_attr);
    };

    Drupal.behaviors.webform_prefill.formKey = function($e) {
        var name = $e.attr('name');
        if ($e.attr('type') == 'checkbox') {
            name = name.slice(0, -(2 + $e.attr('value').length));
        }
        return name.slice(name.lastIndexOf('[') + 1, -1);
    };

    Drupal.behaviors.webform_prefill._keys = function(name) {
        if (name in this.settings.map) {
            return this.settings.map[name];
        }
        return [name];
    };

    Drupal.behaviors.webform_prefill.keys = function(val) {
        return $.map(this._keys(val.name), val.pfxMap);
    };

    Drupal.behaviors.webform_prefill.attach = function(context, settings) {
        if (!prefillStore.browserSupport()) {
            return;
        }

        if (typeof this.settings === 'undefined') {
            var hash = window.location.hash.substr(1);
            if (hash) {
                var new_hash = this.readUrlVars(hash);
                if (new_hash != hash) {
                    window.location.hash = '#' + new_hash;
                }
            }
            if ('webform_prefill' in Drupal.settings) {
                this.settings = Drupal.settings.webform_prefill;
            } else {
                this.settings = {
                    map: {}
                };
            }
        }

        var self = this;
        var $inputs = $('.webform-client-form', context).find('input, select, textarea').not(function(i, element) {
            // Check nearest include and exclude-wrapper.
            var $exclude = $(element).closest('.webform-prefill-exclude');
            var $include = $(element).closest('.webform-prefill-include');
            if ($exclude.length > 0) {
                // Exclude unless there is an include-wrapper inside the exclude wrapper.
                return $include.length <= 0 || $.contains($include.get(), $exclude.get());
            }
            return false;
        });

        $inputs.each(function() {
            var $e = $(this);
            var fk = self.formKey($e);
            if (fk) {
                $e.attr('data-form-key', fk);
            }
        });

        var done = {};
        $inputs.each(function() {
            var e = self.elementFactory($(this));
            if (!(e.cache_key in done)) {
                done[e.cache_key] = true;

                // Get value from all possible keys.
                var value = prefillStore.getFirst(self.keys(e));
                if (value !== null) {
                    e.getAllByName().val(value);
                    // Fix for BE conditional fields (see brightedge.form.js)
                    setTimeout(function() {
                        // 1. change() - gets conditional field to show up
                        // 2. val(value) - sets the value for a conditional field
                        // 3. change() - triggers on change so value is stored
                        e.getAllByName().change().val(value).change();
                    }, 0);
                }
            }
        });

        $inputs.on('change', function() {
            var e = self.elementFactory($(this));
            if (!e.name) {
                return;
            }
            prefillStore.setItem(e.cache_key, e.getVal());
        });
    };

    /**
     * Parse the hash from the hash string and clean them from the string.
     *
     * The hash string is first split into parts using a semi-colon";" as a
     * separator. Each part that contains prefill variables (with the "p:"-prefix)
     * is then removed.
     *
     * All prefill-values are stored into the session store.
     */
    Drupal.behaviors.webform_prefill.readUrlVars = function(hash, store) {
        hash = hash || window.location.hash.substr(1);
        if (!hash) {
            return '';
        }
        store = store || prefillStore;
        var vars = {},
            key, value, p, parts, new_parts = [];
        parts = hash.split(';');
        // Iterate over all parts.
        for (var j = 0; j < parts.length; j++) {
            var part_has_prefill_vars = false;
            var part = parts[j];
            var hashes = part.split('&');
            for (var i = 0; i < hashes.length; i++) {
                p = hashes[i].indexOf('=');
                key = hashes[i].substring(0, p);
                value = hashes[i].substring(p + 1);
                // Only act on p: prefixes.
                if (key.substr(0, 2) == 'p:') {
                    part_has_prefill_vars = true;
                    key = key.substr(2);
                    // Prepare values to be set as list values.
                    if (!(key in vars)) {
                        vars[key] = [];
                    }
                    vars[key].push(value);
                    // Set string values directly.
                    store.setItem('s:' + key, value);
                }
            }
            if (!part_has_prefill_vars) {
                new_parts.push(part);
            }
        }

        // Finally set all list values.
        $.each(vars, function(key, value) {
            store.setItem('l:' + key, value);
        });

        return new_parts.join(';');
    };

}(jQuery));;
/**
 * @file
 * Lazyloader JQuery plugin
 *
 * @author: Daniel Honrade http://drupal.org/user/351112
 *
 * Settings:
 * - distance = distance of the image to the viewable browser screen before it gets loaded
 * - icon     = animating image that appears before the actual image is loaded
 *
 */

(function($) {

    // Window jQuery object global reference.
    var $window;

    // Process lazyloader
    $.fn.lazyloader = function(options) {
        var settings = $.extend($.fn.lazyloader.defaults, options);
        var images = this;

        if (typeof($window) == 'undefined') {
            $window = $(window);
        }

        // add the loader icon
        if (settings['icon'] != '') $('img[data-src]').parent().css({
            position: 'relative',
            display: 'block'
        }).prepend('<img class="lazyloader-icon" src="' + settings['icon'] + '" />');

        // Load on refresh
        loadActualImages(images, settings);

        // Load on scroll
        $window.bind('scroll', function(e) {
            loadActualImages(images, settings);
        });

        // Load on resize
        $window.resize(function(e) {
            loadActualImages(images, settings);
        });

        return this;
    };

    // Defaults
    $.fn.lazyloader.defaults = {
        distance: 0, // the distance (in pixels) of image when loading of the actual image will happen
        icon: '' // display animating icon
    };


    // Loading actual images
    function loadActualImages(images, settings) {
        clearTimeout($.fn.lazyloader.timeout);

        $.fn.lazyloader.timeout = setTimeout(function() {
            images.each(function() {
                var $image = $(this);
                var imageHeight = $image.height(),
                    imageWidth = $image.width();
                var iconTop = Math.round(imageHeight / 2),
                    iconLeft = Math.round(imageWidth / 2),
                    iconFactor = Math.round($image.siblings('img.lazyloader-icon').height() / 2);
                $image.siblings('img.lazyloader-icon').css({
                    top: iconTop - iconFactor,
                    left: iconLeft - iconFactor
                });

                if (windowView(this, settings) && ($image.attr('data-src'))) {
                    loadImage(this);
                    $image.fadeIn('slow');
                }
            });
        }, Drupal.settings.lazyloader.loadImageDelay);
    }


    // Check if the images are within the window view (top, bottom, left and right)
    function windowView(image, settings) {
        var $image = $(image);
        // window variables
        var windowHeight = $window.height(),
            windowWidth = $window.width(),

            windowBottom = windowHeight + $window.scrollTop(),
            windowTop = windowBottom - windowHeight,
            windowRight = windowWidth + $window.scrollLeft(),
            windowLeft = windowRight - windowWidth,

            // image variables
            imageHeight = $image.height(),
            imageWidth = $image.width(),

            imageTop = $image.offset().top - settings['distance'],
            imageBottom = imageTop + imageHeight + settings['distance'],
            imageLeft = $image.offset().left - settings['distance'],
            imageRight = imageLeft + imageWidth + settings['distance'];

        // This will return true if any corner of the image is within the screen
        return (((windowBottom >= imageTop) && (windowTop <= imageTop)) || ((windowBottom >= imageBottom) && (windowTop <= imageBottom))) &&
            (((windowRight >= imageLeft) && (windowLeft <= imageLeft)) || ((windowRight >= imageRight) && (windowLeft <= imageRight)));
    }


    // Load the image
    function loadImage(image) {
        var $image = $(image);
        $image.hide().attr('src', $image.data('src')).removeAttr('data-src');
        $image.on('load', function() {
            $image.siblings('img.lazyloader-icon').remove();
        });
    }

})(jQuery);;

document.addEventListener('DOMContentLoaded', function() {
    var scrollToTopBtn = document.getElementById('scrollToTopBtn');
  
    // Show/hide the button based on scroll position
    window.addEventListener('scroll', function() {
      if (document.body.scrollTop > 20 || document.documentElement.scrollTop > 20) {
        scrollToTopBtn.style.display = 'block';
      } else {
        scrollToTopBtn.style.display = 'none';
      }
    });
  
    // Smooth scroll to top when the button is clicked
    scrollToTopBtn.addEventListener('click', function() {
      scrollToTop();
    });
  
    function scrollToTop() {
      var currentPosition = document.documentElement.scrollTop || document.body.scrollTop;
  
      if (currentPosition > 0) {
        window.requestAnimationFrame(scrollToTop);
        window.scrollTo(0, currentPosition - currentPosition / 8);
      }
    }
  });
  