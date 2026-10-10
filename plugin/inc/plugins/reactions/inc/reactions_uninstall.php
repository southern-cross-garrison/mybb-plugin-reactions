<?php
/**
 * MyBB Reactions Plugin - Uninstallation
 */

if(!defined("IN_MYBB"))
{
    die("Direct initialization of this file is not allowed.");
}

require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_install.php";

/**
 * Drop the plugin's tables, column, settings and cache, and delete the images
 * administrators uploaded.
 */
function reactions_uninstall_database()
{
    global $db, $cache;

    foreach(reactions_plugin_tables() as $table)
    {
        $db->write_query("DROP TABLE IF EXISTS `" . TABLE_PREFIX . $table . "`");
    }

    if($db->field_exists('reactions_notify', 'users'))
    {
        $db->drop_column('users', 'reactions_notify');
    }

    $db->delete_query("settings", "name LIKE 'reactions\\_%'");
    $db->delete_query("settinggroups", "name = 'reactions'");

    $cache->delete('reactions');

    // Only the uploads directory: images/reactions/ holds the bundled defaults, which
    // came with the plugin's files and go when those are deleted.
    $dir = reactions_upload_dir();
    foreach((array)glob($dir . '*') as $file)
    {
        if(is_file($file))
        {
            @unlink($file);
        }
    }
    @rmdir($dir);
}
