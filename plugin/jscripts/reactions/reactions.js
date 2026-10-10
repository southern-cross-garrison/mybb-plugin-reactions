/**
 * MyBB Reactions Plugin - the reactions bar.
 *
 * Works the way Facebook's does. A click (or tap) on the React button is the quick
 * reaction: it adds the default one, or takes back the reaction the member already has.
 * The full picker sits behind a second gesture - resting the mouse on the button, or on a
 * touch screen, which has no hover, pressing and holding it.
 *
 * Everything is delegated from the document, so a post that arrives after the page has
 * loaded (quick reply) works without being wired up, and a bar redrawn after a reaction
 * needs nothing either.
 *
 * Without this script the bar still works: the button and the picker's items are submit
 * buttons in a plain form, and the stylesheet shows the picker on hover and focus. The
 * class added below is what tells the stylesheet to leave that to the script instead.
 */
(function () {
	'use strict';

	document.documentElement.classList.add('reactions-js');

	var OPEN_DELAY = 400;
	var CLOSE_DELAY = 300;
	var LONG_PRESS = 500;

	// Per bar: pending open/close timers, keyed by the form element.
	var timers = new WeakMap();

	function controlsOf(node) {
		return node && node.closest ? node.closest('.reactions-controls') : null;
	}

	function pickerOf(controls) {
		return controls.querySelector('.reactions-picker');
	}

	function buttonOf(controls) {
		return controls.querySelector('.reactions-button');
	}

	function items(controls) {
		return Array.prototype.slice.call(controls.querySelectorAll('.reactions-picker-item'));
	}

	function clearTimers(controls) {
		var pending = timers.get(controls);
		if (pending) {
			clearTimeout(pending.open);
			clearTimeout(pending.close);
		}
		timers.set(controls, {});
	}

	function schedule(controls, which, fn, delay) {
		var pending = timers.get(controls) || {};
		clearTimeout(pending.open);
		clearTimeout(pending.close);
		pending[which] = setTimeout(fn, delay);
		timers.set(controls, pending);
	}

	function isOpen(controls) {
		return pickerOf(controls).classList.contains('reactions-picker--open');
	}

	function open(controls, focus) {
		closeAll(controls);
		clearTimers(controls);
		var picker = pickerOf(controls);
		picker.classList.add('reactions-picker--open');
		buttonOf(controls).setAttribute('aria-expanded', 'true');

		// Roving tabindex: the picker is one stop in the tab order, and the arrow keys move
		// within it.
		var list = items(controls);
		var current =
			list.filter(function (item) {
				return item.getAttribute('aria-pressed') === 'true';
			})[0] || list[0];
		list.forEach(function (item) {
			item.tabIndex = item === current ? 0 : -1;
		});
		if (focus && current) {
			current.focus();
		}
	}

	function close(controls) {
		clearTimers(controls);
		pickerOf(controls).classList.remove('reactions-picker--open');
		buttonOf(controls).setAttribute('aria-expanded', 'false');
	}

	function closeAll(except) {
		var openPickers = document.querySelectorAll('.reactions-picker--open');
		Array.prototype.forEach.call(openPickers, function (picker) {
			var controls = controlsOf(picker);
			if (controls && controls !== except) {
				close(controls);
			}
		});
	}

	function showError(message) {
		if (window.jQuery && jQuery.jGrowl) {
			jQuery.jGrowl(message, { theme: 'jgrowl_error' });
		} else {
			window.alert(message);
		}
	}

	/**
	 * Send the form with the reaction the member picked, and swap the post's bar for the
	 * one the server draws back.
	 */
	function react(controls, rid, restoreFocus) {
		var bar = controls.closest('.reactions');
		if (!bar || bar.getAttribute('aria-busy') === 'true') {
			return;
		}
		bar.setAttribute('aria-busy', 'true');
		close(controls);

		var data = new FormData(controls);
		data.set('rid', rid);
		data.set('ajax', '1');

		fetch(controls.getAttribute('action'), {
			method: 'POST',
			body: data,
			credentials: 'same-origin',
			headers: { 'X-Requested-With': 'XMLHttpRequest' },
		})
			.then(function (response) {
				return response.json().then(function (json) {
					return { ok: response.ok, json: json };
				});
			})
			.then(function (result) {
				if (!result.ok || result.json.error) {
					throw new Error(result.json.error || '');
				}
				var holder = document.createElement('div');
				holder.innerHTML = result.json.html;
				var replacement = holder.firstElementChild;
				if (replacement) {
					bar.parentNode.replaceChild(replacement, bar);
					if (restoreFocus) {
						var button = replacement.querySelector('.reactions-button');
						if (button) {
							button.focus();
						}
					}
				} else {
					bar.removeAttribute('aria-busy');
				}
			})
			.catch(function (error) {
				bar.removeAttribute('aria-busy');
				showError(
					(error && error.message) ||
						(window.lang && lang.unknown_error) ||
						'Your reaction could not be saved.'
				);
			});
	}

	// -----------------------------------------------------------------------------------
	// Mouse: rest on the button to open the picker, move away to close it.
	// -----------------------------------------------------------------------------------

	document.addEventListener('pointerover', function (event) {
		if (event.pointerType !== 'mouse') {
			return;
		}
		var controls = controlsOf(event.target);
		if (!controls || controls.contains(event.relatedTarget)) {
			return;
		}
		if (isOpen(controls)) {
			clearTimers(controls);
		} else {
			schedule(
				controls,
				'open',
				function () {
					open(controls, false);
				},
				OPEN_DELAY
			);
		}
	});

	document.addEventListener('pointerout', function (event) {
		if (event.pointerType !== 'mouse') {
			return;
		}
		var controls = controlsOf(event.target);
		if (!controls || controls.contains(event.relatedTarget)) {
			return;
		}
		schedule(
			controls,
			'close',
			function () {
				close(controls);
			},
			CLOSE_DELAY
		);
	});

	// -----------------------------------------------------------------------------------
	// Touch: press and hold the button to open the picker.
	// -----------------------------------------------------------------------------------

	var press = null;

	document.addEventListener('pointerdown', function (event) {
		if (event.pointerType === 'mouse') {
			return;
		}
		var button = event.target.closest && event.target.closest('.reactions-button');
		if (!button) {
			return;
		}
		var controls = controlsOf(button);
		press = {
			x: event.clientX,
			y: event.clientY,
			opened: false,
			timer: setTimeout(function () {
				press.opened = true;
				open(controls, false);
			}, LONG_PRESS),
		};
	});

	function endPress() {
		if (press) {
			clearTimeout(press.timer);
		}
	}

	document.addEventListener('pointermove', function (event) {
		// A finger that moves is scrolling the page, not holding the button.
		if (
			press &&
			(Math.abs(event.clientX - press.x) > 10 || Math.abs(event.clientY - press.y) > 10)
		) {
			endPress();
		}
	});
	document.addEventListener('pointerup', endPress);
	document.addEventListener('pointercancel', endPress);

	// A long press is the browser's cue for its own menu, and on the button that menu would
	// cover the picker.
	document.addEventListener('contextmenu', function (event) {
		if (event.target.closest && event.target.closest('.reactions-button')) {
			event.preventDefault();
		}
	});

	// -----------------------------------------------------------------------------------
	// Clicks: the button, the picker's items, the summary, and anywhere else.
	// -----------------------------------------------------------------------------------

	document.addEventListener('click', function (event) {
		var target = event.target;

		var choice = target.closest && target.closest('.reactions-controls button[name="rid"]');
		if (choice) {
			event.preventDefault();
			var controls = controlsOf(choice);

			// The click that ends a long press is not a second, separate tap.
			if (press && press.opened && choice.classList.contains('reactions-button')) {
				press = null;
				return;
			}
			press = null;

			// Keyboard activation reports no pointer position.
			var fromKeyboard = event.detail === 0;
			react(controls, choice.value, fromKeyboard);
			return;
		}

		var summary = target.closest && target.closest('.reactions-summary');
		if (
			summary &&
			window.MyBB &&
			MyBB.popupWindow &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.shiftKey
		) {
			event.preventDefault();
			var pid = summary.closest('.reactions').getAttribute('data-pid');
			MyBB.popupWindow(
				'/misc.php?action=reactions_who&pid=' + encodeURIComponent(pid) + '&modal=1'
			);
			return;
		}

		var tab = target.closest && target.closest('.reactions-who-modal .reactions-who-tab');
		if (tab) {
			event.preventDefault();
			selectTab(tab);
			return;
		}

		if (!controlsOf(target)) {
			closeAll(null);
		}
	});

	// -----------------------------------------------------------------------------------
	// Keyboard.
	// -----------------------------------------------------------------------------------

	document.addEventListener('keydown', function (event) {
		var controls = controlsOf(event.target);
		if (!controls) {
			return;
		}

		var onButton = event.target.classList.contains('reactions-button');
		var onItem = event.target.classList.contains('reactions-picker-item');

		if (onButton && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
			event.preventDefault();
			open(controls, true);
			return;
		}

		if (event.key === 'Escape' && isOpen(controls)) {
			event.preventDefault();
			close(controls);
			buttonOf(controls).focus();
			return;
		}

		if (onItem) {
			var list = items(controls);
			var index = list.indexOf(event.target);
			var next = null;
			if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
				next = list[(index + 1) % list.length];
			} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
				next = list[(index - 1 + list.length) % list.length];
			} else if (event.key === 'Home') {
				next = list[0];
			} else if (event.key === 'End') {
				next = list[list.length - 1];
			}
			if (next) {
				event.preventDefault();
				list.forEach(function (item) {
					item.tabIndex = item === next ? 0 : -1;
				});
				next.focus();
			}
		}
	});

	// Tabbing out of a bar closes its picker.
	document.addEventListener('focusout', function (event) {
		var controls = controlsOf(event.target);
		if (controls && !controls.contains(event.relatedTarget) && event.relatedTarget) {
			close(controls);
		}
	});

	// -----------------------------------------------------------------------------------
	// The "who reacted" popup: its tabs filter the list it already has.
	// -----------------------------------------------------------------------------------

	function selectTab(tab) {
		var who = tab.closest('.reactions-who');
		var rid = tab.getAttribute('data-rid');

		Array.prototype.forEach.call(who.querySelectorAll('.reactions-who-tab'), function (other) {
			var selected = other === tab;
			other.classList.toggle('reactions-who-tab--active', selected);
			other.setAttribute('aria-selected', selected ? 'true' : 'false');
		});

		Array.prototype.forEach.call(who.querySelectorAll('.reactions-who-row'), function (row) {
			row.hidden = rid !== '0' && row.getAttribute('data-rid') !== rid;
		});
	}
})();
