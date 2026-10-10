<?php
/**
 * MyBB Reactions Plugin - Admin CP: Configuration -> Reactions
 *
 * Add, edit, reorder, deactivate and delete the reactions members pick from. Laid out the
 * way MyBB's own Smilies and Post Icons pages are, since it is the same kind of list.
 */

if(!defined("IN_MYBB"))
{
    die("Direct initialization of this file is not allowed.");
}

require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_functions.php";
require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_upload.php";

/** @var DefaultPage $page */

$page->add_breadcrumb_item($lang->reactions, "index.php?module=config-reactions");

// The Admin CP is served from its own directory, so the path climbs out of it.
$page->extra_header .= "<link rel=\"stylesheet\" href=\"../jscripts/reactions/reactions-admin.css\" type=\"text/css\" />\n";

$action = $mybb->get_input('action');
$base_url = "index.php?module=config-reactions";

$sub_tabs = array(
    'reactions' => array(
        'title'       => $lang->reactions,
        'link'        => $base_url,
        'description' => $lang->reactions_desc
    ),
    'add' => array(
        'title'       => $lang->reactions_add,
        'link'        => "{$base_url}&amp;action=add",
        'description' => $lang->reactions_add_desc
    ),
);

/**
 * Fetch the reaction named by ?rid=, or go back to the list saying it does not exist.
 *
 * @return array
 */
function reactions_admin_get_reaction()
{
    global $db, $mybb, $lang;

    $reaction = $db->fetch_array($db->simple_select("reactions", "*", "rid = " . $mybb->get_input('rid', MyBB::INPUT_INT)));
    if(!$reaction)
    {
        flash_message($lang->reactions_error_invalid, 'error');
        admin_redirect("index.php?module=config-reactions");
    }

    return $reaction;
}

/**
 * Check a submitted name, returning the problems with it.
 *
 * @param string $name
 * @param int $rid The reaction being edited, so it does not clash with itself; 0 when adding.
 * @return array
 */
function reactions_admin_validate_name($name, $rid)
{
    global $db, $lang;

    $errors = array();
    if($name === '')
    {
        $errors[] = $lang->reactions_error_missing_name;
    }
    elseif(my_strlen($name) > 50)
    {
        $errors[] = $lang->reactions_error_name_too_long;
    }
    // The table's collation is case-insensitive, so "like" clashes with "Like".
    elseif($db->num_rows($db->simple_select("reactions", "rid", "name = '" . $db->escape_string($name) . "' AND rid != " . (int)$rid)) > 0)
    {
        $errors[] = $lang->reactions_error_duplicate_name;
    }

    return $errors;
}

/**
 * The add and edit form.
 *
 * @param string $url Where the form posts.
 * @param array $values name, disporder and active to fill it with.
 * @param array|null $reaction The reaction being edited, for its current image; null when adding.
 */
function reactions_admin_output_form($url, array $values, $reaction)
{
    global $lang, $mybb;

    $max_kb = max(1, (int)$mybb->settings['reactions_max_upload_kb']);

    $form = new Form($url, "post", "reaction_form", true);
    $container = new FormContainer($reaction ? $lang->reactions_edit : $lang->reactions_add);

    $container->output_row(
        $lang->reactions_name . " <em>*</em>",
        $lang->reactions_name_desc,
        $form->generate_text_box('name', $values['name'], array('id' => 'name', 'maxlength' => 50)),
        'name'
    );

    if($reaction)
    {
        $current = "<div class=\"reactions-admin-current\">{$lang->reactions_current_image} <img src=\""
            . htmlspecialchars_uni(reactions_image_url($reaction['image'])) . "\" alt=\""
            . htmlspecialchars_uni($reaction['name']) . "\" class=\"reactions-admin-image\" /></div>";
        $image_row_title = $lang->reactions_image;
        $image_desc = $lang->sprintf($lang->reactions_image_desc_edit, $max_kb);
    }
    else
    {
        $current = '';
        $image_row_title = $lang->reactions_image . " <em>*</em>";
        $image_desc = $lang->sprintf($lang->reactions_image_desc_add, $max_kb);
    }

    $container->output_row(
        $image_row_title,
        $image_desc,
        $current . $form->generate_file_upload_box('image', array('id' => 'image', 'accept' => 'image/png,image/gif,image/jpeg,image/webp,image/svg+xml,.svg')),
        'image'
    );

    $container->output_row(
        $lang->reactions_order,
        $lang->reactions_order_desc,
        $form->generate_numeric_field('disporder', $values['disporder'], array('id' => 'disporder', 'min' => 0)),
        'disporder'
    );

    $container->output_row(
        $lang->reactions_active,
        $lang->reactions_active_desc,
        $form->generate_yes_no_radio('active', $values['active'])
    );

    $container->end();

    $form->output_submit_wrapper(array($form->generate_submit_button($lang->reactions_save)));
    $form->end();
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

if($action == "add")
{
    $errors = array();
    $values = array('name' => '', 'disporder' => 0, 'active' => 1);

    if($mybb->request_method == "post")
    {
        $values = array(
            'name'      => trim($mybb->get_input('name')),
            'disporder' => max(0, $mybb->get_input('disporder', MyBB::INPUT_INT)),
            'active'    => $mybb->get_input('active', MyBB::INPUT_INT) ? 1 : 0,
        );

        $errors = reactions_admin_validate_name($values['name'], 0);

        $file = isset($_FILES['image']) ? $_FILES['image'] : null;
        if(!reactions_upload_given($file))
        {
            $errors[] = $lang->reactions_error_missing_image;
        }
        else
        {
            $upload_error = reactions_validate_upload($file);
            if($upload_error !== null)
            {
                $errors[] = $upload_error;
            }
        }

        if(!$errors)
        {
            // A new reaction with no order of its own goes after the others.
            if($values['disporder'] === 0)
            {
                $max = $db->fetch_field($db->simple_select("reactions", "MAX(disporder) AS max_order"), "max_order");
                $values['disporder'] = (int)$max + 1;
            }

            // The image is named after the reaction's id, so the row comes first - and goes
            // again if the image cannot be stored.
            $rid = (int)$db->insert_query("reactions", array(
                'name'      => $db->escape_string($values['name']),
                'image'     => '',
                'disporder' => $values['disporder'],
                'active'    => $values['active'],
            ));

            $image = reactions_store_upload($file, $rid, $stripped);
            if($image === false)
            {
                $db->delete_query("reactions", "rid = {$rid}");
                $errors[] = $lang->sprintf($lang->reactions_error_cannot_write, 'uploads/reactions/');
            }
            else
            {
                $db->update_query("reactions", array('image' => $db->escape_string($image)), "rid = {$rid}");
                reactions_rebuild_cache();

                log_admin_action($rid, $values['name']);

                flash_message($lang->reactions_success_added . ($stripped ? ' ' . $lang->reactions_svg_stripped : ''), 'success');
                admin_redirect($base_url);
            }
        }
    }

    $page->add_breadcrumb_item($lang->reactions_add);
    $page->output_header($lang->reactions . " - " . $lang->reactions_add);
    $page->output_nav_tabs($sub_tabs, 'add');

    if($errors)
    {
        $page->output_inline_error($errors);
    }

    reactions_admin_output_form("{$base_url}&amp;action=add", $values, null);

    $page->output_footer();
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

if($action == "edit")
{
    $reaction = reactions_admin_get_reaction();
    $rid = (int)$reaction['rid'];

    $errors = array();
    $values = array(
        'name'      => $reaction['name'],
        'disporder' => (int)$reaction['disporder'],
        'active'    => (int)$reaction['active'],
    );

    if($mybb->request_method == "post")
    {
        $values = array(
            'name'      => trim($mybb->get_input('name')),
            'disporder' => max(0, $mybb->get_input('disporder', MyBB::INPUT_INT)),
            'active'    => $mybb->get_input('active', MyBB::INPUT_INT) ? 1 : 0,
        );

        $errors = reactions_admin_validate_name($values['name'], $rid);

        $file = isset($_FILES['image']) ? $_FILES['image'] : null;
        $replace_image = reactions_upload_given($file);
        if($replace_image)
        {
            $upload_error = reactions_validate_upload($file);
            if($upload_error !== null)
            {
                $errors[] = $upload_error;
            }
        }

        if(!$errors)
        {
            $update = array(
                'name'      => $db->escape_string($values['name']),
                'disporder' => $values['disporder'],
                'active'    => $values['active'],
            );

            if($replace_image)
            {
                $image = reactions_store_upload($file, $rid, $stripped);
                if($image === false)
                {
                    $errors[] = $lang->sprintf($lang->reactions_error_cannot_write, 'uploads/reactions/');
                }
                else
                {
                    $update['image'] = $db->escape_string($image);
                }
            }

            if(!$errors)
            {
                $db->update_query("reactions", $update, "rid = {$rid}");

                // Only once the row points at the new image: the old one is still what
                // every page shows until then.
                if($replace_image)
                {
                    reactions_delete_uploaded_image($reaction['image']);
                }

                reactions_rebuild_cache();

                log_admin_action($rid, $values['name']);

                flash_message($lang->reactions_success_edited . (!empty($stripped) ? ' ' . $lang->reactions_svg_stripped : ''), 'success');
                admin_redirect($base_url);
            }
        }
    }

    $page->add_breadcrumb_item($lang->reactions_edit);
    $page->output_header($lang->reactions . " - " . $lang->reactions_edit);

    $sub_tabs['edit'] = array(
        'title'       => $lang->reactions_edit,
        'link'        => "{$base_url}&amp;action=edit&amp;rid={$rid}",
        'description' => $lang->reactions_edit_desc
    );
    $page->output_nav_tabs($sub_tabs, 'edit');

    if($errors)
    {
        $page->output_inline_error($errors);
    }

    reactions_admin_output_form("{$base_url}&amp;action=edit&amp;rid={$rid}", $values, $reaction);

    $page->output_footer();
}

// ---------------------------------------------------------------------------
// Activate / deactivate
// ---------------------------------------------------------------------------

if($action == "activate" || $action == "deactivate")
{
    // Links rather than forms, so the post key is checked here: MyBB checks it for every
    // Admin CP POST, but not for a GET. In the Admin CP verify_post_check() returns false
    // rather than stopping the page, so the result has to be acted on.
    if(!verify_post_check($mybb->get_input('my_post_key')))
    {
        flash_message($lang->invalid_post_verify_key2, 'error');
        admin_redirect($base_url);
    }

    $reaction = reactions_admin_get_reaction();
    $active = $action == "activate" ? 1 : 0;

    $db->update_query("reactions", array('active' => $active), "rid = " . (int)$reaction['rid']);
    reactions_rebuild_cache();

    log_admin_action((int)$reaction['rid'], $reaction['name']);

    flash_message($active ? $lang->reactions_success_activated : $lang->reactions_success_deactivated, 'success');
    admin_redirect($base_url);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

if($action == "delete")
{
    $reaction = reactions_admin_get_reaction();
    $rid = (int)$reaction['rid'];

    if($mybb->get_input('no'))
    {
        admin_redirect($base_url);
    }

    if($mybb->request_method == "post")
    {
        $db->delete_query("reactions_post", "rid = {$rid}");
        $db->delete_query("reactions", "rid = {$rid}");
        reactions_delete_uploaded_image($reaction['image']);
        reactions_rebuild_cache();

        log_admin_action($rid, $reaction['name']);

        flash_message($lang->reactions_success_deleted, 'success');
        admin_redirect($base_url);
    }

    $used = (int)$db->fetch_field($db->simple_select("reactions_post", "COUNT(*) AS used", "rid = {$rid}"), "used");
    $message = $used > 0
        ? $lang->sprintf($lang->reactions_confirm_delete_used, htmlspecialchars_uni($reaction['name']), my_number_format($used))
        : $lang->sprintf($lang->reactions_confirm_delete, htmlspecialchars_uni($reaction['name']));

    $page->output_confirm_action("{$base_url}&amp;action=delete&amp;rid={$rid}", $message);
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

if($action == "order" && $mybb->request_method == "post")
{
    $orders = $mybb->get_input('disporder', MyBB::INPUT_ARRAY);
    foreach($orders as $rid => $order)
    {
        $db->update_query("reactions", array('disporder' => max(0, (int)$order)), "rid = " . (int)$rid);
    }
    reactions_rebuild_cache();

    log_admin_action();

    flash_message($lang->reactions_success_ordered, 'success');
    admin_redirect($base_url);
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

if(!$action || $action == "order")
{
    $page->output_header($lang->reactions);
    $page->output_nav_tabs($sub_tabs, 'reactions');

    $used = array();
    $query = $db->simple_select("reactions_post", "rid, COUNT(*) AS used", "", array('group_by' => 'rid'));
    while($row = $db->fetch_array($query))
    {
        $used[(int)$row['rid']] = (int)$row['used'];
    }

    $default = reactions_default();

    $form = new Form("{$base_url}&amp;action=order", "post");

    $table = new Table;
    $table->construct_header($lang->reactions_image, array('class' => 'align_center', 'width' => '1'));
    $table->construct_header($lang->reactions_name);
    $table->construct_header($lang->reactions_status, array('class' => 'align_center', 'width' => '10%'));
    $table->construct_header($lang->reactions_used, array('class' => 'align_center', 'width' => '10%'));
    $table->construct_header($lang->reactions_order, array('class' => 'align_center', 'width' => '10%'));
    $table->construct_header($lang->reactions_controls, array('class' => 'align_center', 'width' => '1'));

    $query = $db->simple_select("reactions", "*", "", array('order_by' => 'disporder ASC, rid', 'order_dir' => 'ASC'));
    while($reaction = $db->fetch_array($query))
    {
        $rid = (int)$reaction['rid'];
        $name = htmlspecialchars_uni($reaction['name']);

        $table->construct_cell("<img src=\"" . htmlspecialchars_uni(reactions_image_url($reaction['image'])) . "\" alt=\"{$name}\" class=\"reactions-admin-image\" />", array('class' => 'align_center'));

        $marker = $default && (int)$default['rid'] === $rid ? " <span class=\"smalltext\">{$lang->reactions_default_marker}</span>" : '';
        $table->construct_cell("<a href=\"{$base_url}&amp;action=edit&amp;rid={$rid}\"><strong>{$name}</strong></a>{$marker}");

        $table->construct_cell($reaction['active'] ? $lang->reactions_active : $lang->reactions_inactive, array('class' => 'align_center reactions-admin-status'));
        $table->construct_cell(my_number_format(isset($used[$rid]) ? $used[$rid] : 0), array('class' => 'align_center'));
        $table->construct_cell($form->generate_numeric_field("disporder[{$rid}]", (int)$reaction['disporder'], array('min' => 0, 'style' => 'width: 4em;', 'id' => "disporder_{$rid}")), array('class' => 'align_center'));

        $popup = new PopupMenu("reaction_{$rid}", $lang->options);
        $popup->add_item($lang->reactions_edit, "{$base_url}&amp;action=edit&amp;rid={$rid}");
        if($reaction['active'])
        {
            $popup->add_item($lang->reactions_deactivate, "{$base_url}&amp;action=deactivate&amp;rid={$rid}&amp;my_post_key={$mybb->post_code}");
        }
        else
        {
            $popup->add_item($lang->reactions_activate, "{$base_url}&amp;action=activate&amp;rid={$rid}&amp;my_post_key={$mybb->post_code}");
        }
        $popup->add_item($lang->reactions_delete, "{$base_url}&amp;action=delete&amp;rid={$rid}");
        $table->construct_cell($popup->fetch(), array('class' => 'align_center'));

        $table->construct_row(array('id' => "reaction_row_{$rid}"));
    }

    if($table->num_rows() == 0)
    {
        $table->construct_cell($lang->reactions_none, array('colspan' => 6));
        $table->construct_row();
        $table->output($lang->reactions);
    }
    else
    {
        $table->output($lang->reactions);
        $form->output_submit_wrapper(array($form->generate_submit_button($lang->reactions_save_order)));
    }

    $form->end();

    $page->output_footer();
}
