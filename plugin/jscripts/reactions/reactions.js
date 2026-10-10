/**
 * MyBB Reactions Plugin - the reactions bar.
 *
 * A click (or tap) on the React button is the quick reaction: it adds the default one, or
 * takes back the reaction the member already has. The full picker sits behind pressing and
 * holding the button, with a mouse or a finger alike, or the arrow keys; still holding,
 * slide onto a reaction and let go to pick it, or let go and click one. Hovering does
 * nothing: the button sits among the post's other controls, and a picker that sprang open
 * as the pointer crossed it on the way to Edit would be in the way.
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

	var LONG_PRESS = 500;
	// How close the picker may come to the edge of the screen, in pixels.
	var EDGE = 8;

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

	function isOpen(controls) {
		return pickerOf(controls).classList.contains('reactions-picker--open');
	}

	function open(controls, focus) {
		closeAll(controls);
		var picker = pickerOf(controls);
		picker.classList.add('reactions-picker--open');
		buttonOf(controls).setAttribute('aria-expanded', 'true');

		// The picker opens leftward from the bar, at the right of the post. On a narrow
		// screen that can run it off the left edge, so slide it back on. Measured from the
		// bar and the picker's layout width, which the opening animation's scale leaves be.
		picker.style.right = '';
		var left = controls.getBoundingClientRect().right - picker.offsetWidth;
		if (left < EDGE) {
			picker.style.right = left - EDGE + 'px';
		}

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
	// Press and hold the button to open the picker - and, still holding, slide onto a
	// reaction and let go to pick it.
	// -----------------------------------------------------------------------------------

	var press = null;

	document.addEventListener('pointerdown', function (event) {
		// The main button only: a right-click is not the start of a long press.
		if (event.button !== 0) {
			return;
		}
		var button = event.target.closest && event.target.closest('.reactions-button');
		if (!button) {
			// A long press on a touch screen may end with no click at all; the next press
			// anywhere else ends it instead, so its click is not mistaken for that one.
			press = null;
			return;
		}
		var controls = controlsOf(button);
		// Touch events go to the element the touch started on, so the button is where to
		// stop a finger sliding across the open picker from scrolling the page. Adding the
		// same listener twice is a no-op.
		button.addEventListener('touchmove', holdStill, { passive: false });
		press = {
			controls: controls,
			x: event.clientX,
			y: event.clientY,
			held: true,
			opened: false,
			timer: setTimeout(function () {
				press.opened = true;
				open(controls, false);
			}, LONG_PRESS),
		};
	});

	function holdStill(event) {
		if (press && press.held && press.opened) {
			event.preventDefault();
		}
	}

	/** The picker item under the pointer, in the bar the press started in. */
	function itemAt(event) {
		var node = document.elementFromPoint(event.clientX, event.clientY);
		var item = node && node.closest && node.closest('.reactions-picker-item');
		return item && press.controls.contains(item) ? item : null;
	}

	/** Mark the item letting go would pick: a finger has no hover to show it. */
	function highlight(item) {
		items(press.controls).forEach(function (other) {
			other.classList.toggle('reactions-picker-item--hover', other === item);
		});
	}

	document.addEventListener('pointermove', function (event) {
		if (!press || !press.held) {
			return;
		}
		if (press.opened) {
			highlight(itemAt(event));
			return;
		}
		// Before the picker opens, a finger that moves is scrolling the page, and a mouse
		// that moves is leaving the button, not holding it.
		if (Math.abs(event.clientX - press.x) > 10 || Math.abs(event.clientY - press.y) > 10) {
			clearTimeout(press.timer);
		}
	});

	document.addEventListener('pointerup', function (event) {
		if (!press || !press.held) {
			return;
		}
		clearTimeout(press.timer);
		press.held = false;
		if (!press.opened) {
			return;
		}
		// Let go on a reaction: that is the pick. Let go anywhere else and the picker stays
		// open to be clicked. The click the browser may send after this lands on the bar or
		// on the button, neither of which reacts to it.
		var item = itemAt(event);
		highlight(null);
		if (item) {
			react(press.controls, item.value, false);
		}
	});

	document.addEventListener('pointercancel', function () {
		if (press) {
			clearTimeout(press.timer);
			press.held = false;
			highlight(null);
		}
	});

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

		// The click the browser sends at the end of a long press is not a click of its own:
		// wherever it lands - the button, the bar, somewhere off the picker - the press has
		// already done what it does, and the picker stays open.
		if (press && press.opened && !press.held) {
			press = null;
			event.preventDefault();
			return;
		}
		press = null;

		var choice = target.closest && target.closest('.reactions-controls button[name="rid"]');
		if (choice) {
			event.preventDefault();
			var controls = controlsOf(choice);

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
		var tabs = who.querySelector('.reactions-who-tabs');
		var list = who.querySelector('.reactions-who-list');
		var all = Array.prototype.slice.call(who.querySelectorAll('.reactions-who-tab'));
		var current = who.querySelector('.reactions-who-tab--active') || all[0];
		var rid = tab.getAttribute('data-rid');
		if (tab === current) {
			return;
		}

		pinPopup(who.closest('.reactions-who-modal'));
		var from = list.getBoundingClientRect().height;

		// One underline that slides from tab to tab, in place of each tab's own. The first
		// time, it starts where the opening tab's own underline was.
		if (!tabs.classList.contains('reactions-who-tabs--sliding')) {
			placeUnderline(tabs, current);
			tabs.classList.add('reactions-who-tabs--sliding');
			void tabs.offsetWidth; // Settle the starting place, so the move is animated.
		}

		all.forEach(function (other) {
			var selected = other === tab;
			other.classList.toggle('reactions-who-tab--active', selected);
			other.setAttribute('aria-selected', selected ? 'true' : 'false');
		});
		// Measured after the switch: the current tab is bold, and wider for it.
		placeUnderline(tabs, tab);
		if (tab.scrollIntoView) {
			tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		}

		// The new tab's rows come in from the side it is on, one just after another.
		list.style.setProperty(
			'--reactions-who-shift',
			all.indexOf(tab) > all.indexOf(current) ? '16px' : '-16px'
		);
		var rows = Array.prototype.slice.call(who.querySelectorAll('.reactions-who-row'));
		rows.forEach(function (row) {
			row.classList.remove('reactions-who-row--in');
			row.hidden = rid !== '0' && row.getAttribute('data-rid') !== rid;
		});
		list.scrollTop = 0;

		// The list grows or shrinks to fit the new tab's rows, smoothly, from whatever
		// height it is at - part way through the last change, if the tabs are clicked fast.
		list.style.height = '';
		var to = list.getBoundingClientRect().height;
		list.style.height = from + 'px';
		void list.offsetWidth; // Settle the starting height, which also restarts the rows.
		list.style.height = to + 'px';

		var order = 0;
		rows.forEach(function (row) {
			if (!row.hidden) {
				row.style.setProperty('--reactions-who-order', String(Math.min(order++, 8)));
				row.classList.add('reactions-who-row--in');
			}
		});
	}

	/**
	 * Keep the popup's top where it opened. MyBB centres a popup on the page, so as the
	 * list's height changed the whole popup would move, header and all.
	 */
	function pinPopup(modal) {
		if (!modal || modal.classList.contains('reactions-who-modal--pinned')) {
			return;
		}
		// Measured exactly, fractions and all: rounded, the header would still shift by a
		// hair. The page does not scroll between the two readings.
		var centred = modal.getBoundingClientRect().top;
		modal.classList.add('reactions-who-modal--pinned');
		modal.style.top = centred - modal.getBoundingClientRect().top + 'px';
	}

	function placeUnderline(tabs, tab) {
		tabs.style.setProperty('--reactions-who-tab-left', tab.offsetLeft + 'px');
		tabs.style.setProperty('--reactions-who-tab-width', tab.offsetWidth + 'px');
	}
})();
