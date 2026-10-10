<?php
/**
 * MyBB Reactions Plugin - Admin CP language strings
 */

$l['reactions'] = "Reactions";

$l['reactions_desc'] = "The reactions members can pick from on posts. The first active reaction is the one a plain click on the React button adds.";
$l['reactions_add'] = "Add Reaction";
$l['reactions_add_desc'] = "Add a reaction members can pick from on posts.";
$l['reactions_edit'] = "Edit Reaction";
$l['reactions_edit_desc'] = "Change a reaction's name, image, order or availability. Members who already reacted with it keep their reaction.";

// The list.
$l['reactions_image'] = "Image";
$l['reactions_name'] = "Name";
$l['reactions_order'] = "Order";
$l['reactions_status'] = "Status";
$l['reactions_used'] = "Used";
$l['reactions_controls'] = "Controls";
$l['reactions_active'] = "Active";
$l['reactions_inactive'] = "Inactive";
$l['reactions_default_marker'] = "(default)";
$l['reactions_none'] = "There are no reactions yet. Members will not see the React button until there is at least one active reaction.";
$l['reactions_save_order'] = "Save Order";
$l['reactions_activate'] = "Activate";
$l['reactions_deactivate'] = "Deactivate";
$l['reactions_delete'] = "Delete";

// The form.
$l['reactions_name_desc'] = "Shown in the picker and in the list of who reacted. Up to 50 characters.";
$l['reactions_image_desc_add'] = "A PNG, GIF, JPEG, WebP or SVG image of up to {1} KB. Square images look best; it is shown at 18 pixels in a post's summary and 36 in the picker.";
$l['reactions_image_desc_edit'] = "Leave empty to keep the current image. A PNG, GIF, JPEG, WebP or SVG image of up to {1} KB.";
$l['reactions_current_image'] = "Current image:";
$l['reactions_order_desc'] = "Where the reaction appears in the picker, lowest first.";
$l['reactions_active_desc'] = "An inactive reaction is not offered in the picker, and posts stop showing it - but members who reacted with it keep their reaction, and it comes back if the reaction is made active again.";
$l['reactions_save'] = "Save Reaction";

// Results.
$l['reactions_success_added'] = "The reaction has been added.";
$l['reactions_success_edited'] = "The reaction has been saved.";
$l['reactions_success_deleted'] = "The reaction has been deleted.";
$l['reactions_success_activated'] = "The reaction is now active.";
$l['reactions_success_deactivated'] = "The reaction is now inactive.";
$l['reactions_success_ordered'] = "The order has been saved.";
$l['reactions_svg_stripped'] = "Scripts, links and other active content were removed from its SVG image, which is safe to show.";
$l['reactions_confirm_delete'] = "Are you sure you want to delete the reaction \"{1}\"?";
$l['reactions_confirm_delete_used'] = "Are you sure you want to delete the reaction \"{1}\"? It has been used {2} times, and every one of those reactions will be deleted with it. To hide it without losing them, deactivate it instead.";

// Errors.
$l['reactions_error_invalid'] = "That reaction does not exist.";
$l['reactions_error_missing_name'] = "Give the reaction a name.";
$l['reactions_error_name_too_long'] = "A reaction's name can be at most 50 characters.";
$l['reactions_error_duplicate_name'] = "There is already a reaction with that name.";
$l['reactions_error_missing_image'] = "Choose an image for the reaction.";
$l['reactions_error_upload_failed'] = "The image could not be uploaded. Please try again.";
$l['reactions_error_too_large'] = "The image is too large. Reaction images can be at most {1} KB.";
$l['reactions_error_bad_svg'] = "That file is not an SVG image the forum can read. SVGs with a DOCTYPE cannot be uploaded.";
$l['reactions_error_svg_unsupported'] = "SVG images cannot be checked on this server, because PHP's DOM extension is not installed. Please use a PNG, GIF, JPEG or WebP image.";
$l['reactions_error_bad_type'] = "Reaction images must be PNG, GIF, JPEG, WebP or SVG.";
$l['reactions_error_not_image'] = "That file is not a valid image, or its contents do not match its extension.";
$l['reactions_error_cannot_write'] = "The image could not be saved: the {1} directory is not writable.";

// The administrator log, looked up as admin_log_config_reactions_<action>.
$l['admin_log_config_reactions_add'] = "Added reaction #{1} ({2})";
$l['admin_log_config_reactions_edit'] = "Edited reaction #{1} ({2})";
$l['admin_log_config_reactions_delete'] = "Deleted reaction #{1} ({2})";
$l['admin_log_config_reactions_activate'] = "Activated reaction #{1} ({2})";
$l['admin_log_config_reactions_deactivate'] = "Deactivated reaction #{1} ({2})";
$l['admin_log_config_reactions_order'] = "Reordered the reactions";
