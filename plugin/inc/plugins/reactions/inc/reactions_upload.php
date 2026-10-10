<?php
/**
 * MyBB Reactions Plugin - Reaction image uploads
 *
 * PNG, GIF, JPEG and WebP images are checked to be what they say they are and stored as
 * they came. SVGs are different: an SVG is a document rather than a picture, and one
 * opened directly from uploads/ would run whatever script it carries on the forum's own
 * origin, logged in as whoever opened it. So an uploaded SVG is rebuilt from an allowlist
 * of drawing elements and attributes (reactions_sanitize_svg()), and only what survives is
 * stored.
 */

if(!defined("IN_MYBB"))
{
    die("Direct initialization of this file is not allowed.");
}

require_once MYBB_ROOT . "inc/plugins/reactions/inc/reactions_functions.php";

/** The namespaces an SVG's elements and attributes may come from. */
define('REACTIONS_SVG_NS', 'http://www.w3.org/2000/svg');
define('REACTIONS_XLINK_NS', 'http://www.w3.org/1999/xlink');
define('REACTIONS_XML_NS', 'http://www.w3.org/XML/1998/namespace');

/**
 * The image types a reaction can be, by extension, with the type getimagesize() has to
 * find in the file for it to count as one. SVG has no entry: getimagesize() cannot read
 * one, and reactions_sanitize_svg() decides instead.
 *
 * @return array extension => MIME type
 */
function reactions_upload_types()
{
    return array(
        'png'  => 'image/png',
        'gif'  => 'image/gif',
        'jpg'  => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'webp' => 'image/webp',
    );
}

/**
 * Whether a file was chosen in an upload field at all.
 *
 * @param array|null $file An entry from $_FILES.
 * @return bool
 */
function reactions_upload_given($file)
{
    return is_array($file) && isset($file['error']) && (int)$file['error'] !== UPLOAD_ERR_NO_FILE;
}

/**
 * The extension an upload is stored under, lower-cased, with jpeg spelt jpg.
 *
 * @param array $file An entry from $_FILES.
 * @return string
 */
function reactions_upload_extension(array $file)
{
    $extension = strtolower(pathinfo((string)$file['name'], PATHINFO_EXTENSION));

    return $extension === 'jpeg' ? 'jpg' : $extension;
}

/**
 * Check an uploaded reaction image.
 *
 * The extension decides nothing on its own: a raster image has to be one getimagesize()
 * can read, of the matching type, and an SVG has to come through reactions_sanitize_svg()
 * as an SVG, so a script renamed to .png or .svg gets no further.
 *
 * @param array $file An entry from $_FILES.
 * @return string|null An error message, or null when the image is fine.
 */
function reactions_validate_upload(array $file)
{
    global $lang, $mybb;

    $max_kb = max(1, (int)$mybb->settings['reactions_max_upload_kb']);

    if((int)$file['error'] === UPLOAD_ERR_INI_SIZE || (int)$file['error'] === UPLOAD_ERR_FORM_SIZE)
    {
        return $lang->sprintf($lang->reactions_error_too_large, $max_kb);
    }
    if((int)$file['error'] !== UPLOAD_ERR_OK || empty($file['tmp_name']) || !is_uploaded_file($file['tmp_name']))
    {
        return $lang->reactions_error_upload_failed;
    }

    if((int)$file['size'] > $max_kb * 1024)
    {
        return $lang->sprintf($lang->reactions_error_too_large, $max_kb);
    }

    $extension = reactions_upload_extension($file);

    if($extension === 'svg')
    {
        if(!class_exists('DOMDocument'))
        {
            return $lang->reactions_error_svg_unsupported;
        }

        $removed = 0;
        if(reactions_sanitize_svg((string)file_get_contents($file['tmp_name']), $removed) === false)
        {
            return $lang->reactions_error_bad_svg;
        }

        return null;
    }

    $types = reactions_upload_types();
    if(!isset($types[$extension]))
    {
        return $lang->reactions_error_bad_type;
    }

    $info = @getimagesize($file['tmp_name']);
    if(!$info || empty($info['mime']) || $info['mime'] !== $types[$extension])
    {
        return $lang->reactions_error_not_image;
    }

    return null;
}

/**
 * Move a checked upload into the reactions upload directory - or, for an SVG, write the
 * sanitized copy there and leave the upload itself behind for PHP to delete.
 *
 * Named after the reaction with a random suffix, so replacing a reaction's image gives it
 * a new URL and nobody is left looking at the old one out of their browser's cache.
 *
 * @param array $file An entry from $_FILES, already through reactions_validate_upload().
 * @param int $rid
 * @param int $removed Set to how many things were taken out of an SVG; 0 for anything else.
 * @return string|false The image's path relative to the forum root, or false.
 */
function reactions_store_upload(array $file, $rid, &$removed = 0)
{
    $removed = 0;

    $dir = reactions_upload_dir();
    if(!is_dir($dir))
    {
        @mkdir($dir, 0755, true);
        // The same guard against directory listings as the rest of uploads/.
        @file_put_contents($dir . "index.html", "<html>\n<head>\n<title></title>\n</head>\n<body>\n&nbsp;\n</body>\n</html>");
    }
    if(!is_dir($dir) || !is_writable($dir))
    {
        return false;
    }

    $extension = reactions_upload_extension($file);
    $filename = "r" . (int)$rid . "_" . random_str(8) . "." . $extension;

    if($extension === 'svg')
    {
        $svg = reactions_sanitize_svg((string)file_get_contents($file['tmp_name']), $removed);
        if($svg === false || @file_put_contents($dir . $filename, $svg) === false)
        {
            return false;
        }
    }
    elseif(!@move_uploaded_file($file['tmp_name'], $dir . $filename))
    {
        return false;
    }
    @chmod($dir . $filename, 0644);

    return "uploads/reactions/" . $filename;
}

/**
 * Delete a reaction's image, if it is one that was uploaded.
 *
 * The bundled defaults under images/reactions/ belong to the plugin's files and are left
 * alone, as is anything else an image path might name: only a plain file name directly
 * inside uploads/reactions/ is ever deleted.
 *
 * @param string $image A path relative to the forum root.
 */
function reactions_delete_uploaded_image($image)
{
    if(!preg_match('#^uploads/reactions/([A-Za-z0-9_]+\.[a-z]+)$#', (string)$image, $match))
    {
        return;
    }

    $path = reactions_upload_dir() . $match[1];
    if(is_file($path))
    {
        @unlink($path);
    }
}

// ---------------------------------------------------------------------------
// SVG sanitizing
// ---------------------------------------------------------------------------

/**
 * The SVG elements that may stay in an uploaded image: shapes, text, paint servers,
 * clipping, masking, filters and animation. Lower-cased, as they are compared.
 *
 * Everything else goes, with everything inside it - most to the point <script>,
 * <foreignObject> (which embeds HTML, and HTML's own scripts with it), <a> and <image>
 * (which would follow or fetch a URL), <iframe>, <object> and <embed>, and anything from
 * another namespace, such as the editor bookkeeping Inkscape and Illustrator leave in.
 *
 * @return array element => true
 */
function reactions_svg_allowed_elements()
{
    static $allowed = null;

    if($allowed === null)
    {
        $allowed = array_fill_keys(array(
            'svg', 'g', 'defs', 'symbol', 'use', 'switch', 'title', 'desc', 'style',
            'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
            'text', 'tspan', 'textpath',
            'lineargradient', 'radialgradient', 'stop', 'pattern', 'marker',
            'clippath', 'mask',
            'filter', 'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite',
            'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap', 'fedistantlight',
            'fedropshadow', 'feflood', 'fefunca', 'fefuncb', 'fefuncg', 'fefuncr',
            'fegaussianblur', 'femerge', 'femergenode', 'femorphology', 'feoffset',
            'fepointlight', 'fespecularlighting', 'fespotlight', 'fetile', 'feturbulence',
            'animate', 'animatemotion', 'animatetransform', 'set', 'mpath',
        ), true);
    }

    return $allowed;
}

/**
 * Whether a value, once the tricks browsers forgive are undone, names a URL scheme that
 * runs or embeds content: "java\tscript:" and "JaVaScRiPt:" are both javascript:. Entities
 * have already been decoded by the parser by the time a value gets here.
 *
 * @param string $value
 * @return bool
 */
function reactions_svg_value_is_dangerous($value)
{
    $squashed = strtolower(preg_replace('#[\x00-\x20\x7f]+#', '', (string)$value));

    return (bool)preg_match('#(javascript|vbscript|livescript|data):|expression\(|@import|behaviou?r:|-moz-binding#', $squashed);
}

/**
 * Whether CSS - a <style> element's text, or a style attribute - could fetch or run
 * anything: a scheme reactions_svg_value_is_dangerous() catches, or a url() that points
 * anywhere but at something in the same file (url(#gradient) is how fills are written).
 *
 * @param string $css
 * @return bool
 */
function reactions_svg_css_is_dangerous($css)
{
    if(reactions_svg_value_is_dangerous($css))
    {
        return true;
    }

    // Every url( ... ) must start with #, quotes and whitespace aside. CSS escapes could
    // otherwise hide a scheme from the check above, so a backslash anywhere fails it too.
    if(strpos($css, '\\') !== false)
    {
        return true;
    }
    if(preg_match_all('#url\s*\(\s*([\'"]?)\s*(.)#i', $css, $matches))
    {
        foreach($matches[2] as $first)
        {
            if($first !== '#')
            {
                return true;
            }
        }
    }

    return false;
}

/**
 * Rebuild an uploaded SVG from what is safe in it.
 *
 * The file is parsed, not pattern-matched, so there is no spelling of <script> or onload=
 * that slips past: each element is either on reactions_svg_allowed_elements() and in the
 * SVG namespace, or it is removed with its contents; each attribute is either harmless or
 * removed. Removed are:
 *
 * - event handlers (onload=, onclick= and every other on...);
 * - href and xlink:href, unless they point at something inside the same file (#id), as
 *   <use> and gradients do;
 * - any value naming a javascript:, vbscript: or data: URL;
 * - style attributes and <style> elements whose CSS could fetch or run anything;
 * - animations that would change a link or an event handler;
 * - attributes from other namespaces, comments and processing instructions
 *   (<?xml-stylesheet?> among them).
 *
 * A file with a DOCTYPE is refused outright rather than parsed: that is where entity
 * expansion attacks live, and no drawing needs one.
 *
 * @param string $svg The uploaded file's contents.
 * @param int $removed Set to how many elements and attributes were removed.
 * @return string|false The sanitized SVG, or false when the file is not an SVG at all.
 */
function reactions_sanitize_svg($svg, &$removed = 0)
{
    $removed = 0;

    if(trim($svg) === '' || stripos($svg, '<!DOCTYPE') !== false || stripos($svg, '<!ENTITY') !== false)
    {
        return false;
    }

    $dom = new DOMDocument();
    $previous = libxml_use_internal_errors(true);
    // No network, no entity substitution: the parser reads this file and nothing else.
    $loaded = $dom->loadXML($svg, LIBXML_NONET | LIBXML_COMPACT);
    libxml_clear_errors();
    libxml_use_internal_errors($previous);

    $root = $loaded ? $dom->documentElement : null;
    if(!$root || $root->namespaceURI !== REACTIONS_SVG_NS || strtolower($root->localName) !== 'svg')
    {
        return false;
    }

    // Comments and processing instructions outside the root go too.
    foreach(iterator_to_array($dom->childNodes, false) as $node)
    {
        if($node !== $root)
        {
            $dom->removeChild($node);
            $removed++;
        }
    }

    reactions_sanitize_svg_element($root, $removed);

    return $dom->saveXML($root);
}

/**
 * Sanitize one element of an SVG in place: its attributes, then its children.
 *
 * @param DOMElement $element An element already known to be allowed.
 * @param int $removed Counts what was removed.
 */
function reactions_sanitize_svg_element(DOMElement $element, &$removed)
{
    $allowed = reactions_svg_allowed_elements();
    $name = strtolower($element->localName);

    foreach(iterator_to_array($element->attributes, false) as $attribute)
    {
        if(!reactions_svg_attribute_allowed($name, $attribute))
        {
            $element->removeAttributeNode($attribute);
            $removed++;
        }
    }

    // A <style> whose CSS cannot be trusted is emptied rather than picked apart. Judged on
    // all of its text at once, so nothing can be split between a text node and a CDATA
    // section to get past the check.
    if($name === 'style' && reactions_svg_css_is_dangerous($element->textContent))
    {
        while($element->firstChild)
        {
            $element->removeChild($element->firstChild);
        }
        $removed++;
        return;
    }

    foreach(iterator_to_array($element->childNodes, false) as $child)
    {
        if($child instanceof DOMElement)
        {
            $child_name = strtolower($child->localName);
            if($child->namespaceURI !== REACTIONS_SVG_NS || !isset($allowed[$child_name])
                || !reactions_svg_animation_allowed($child))
            {
                $element->removeChild($child);
                $removed++;
                continue;
            }

            reactions_sanitize_svg_element($child, $removed);
        }
        elseif($child instanceof DOMComment || $child instanceof DOMProcessingInstruction)
        {
            $element->removeChild($child);
            $removed++;
        }
    }
}

/**
 * Whether an animation element may stay: any animation of colour, size or position is
 * fine, but one that sets a link, a handler or a style could put back what the attribute
 * checks took out.
 *
 * @param DOMElement $element
 * @return bool
 */
function reactions_svg_animation_allowed(DOMElement $element)
{
    $name = strtolower($element->localName);
    if(!in_array($name, array('animate', 'animatemotion', 'animatetransform', 'set'), true))
    {
        return true;
    }

    $target = strtolower(trim($element->getAttribute('attributeName')));

    return !preg_match('#(^|:)(href|style)$|^on#', $target);
}

/**
 * Whether one attribute may stay on an element.
 *
 * @param string $element The element's lower-cased name.
 * @param DOMAttr $attribute
 * @return bool
 */
function reactions_svg_attribute_allowed($element, DOMAttr $attribute)
{
    $name = strtolower($attribute->localName);
    $value = $attribute->value;

    if($attribute->namespaceURI === REACTIONS_XML_NS)
    {
        return $name === 'space' || $name === 'lang';
    }

    if($attribute->namespaceURI === REACTIONS_XLINK_NS)
    {
        return $name === 'href' && reactions_svg_is_local_reference($value);
    }

    // Anything else namespaced is an editor's (inkscape:, sodipodi:) or an attempt.
    if($attribute->namespaceURI !== null && $attribute->namespaceURI !== '')
    {
        return false;
    }

    if(strpos($name, 'on') === 0)
    {
        return false;
    }

    if($name === 'href')
    {
        return reactions_svg_is_local_reference($value);
    }

    if($name === 'style')
    {
        return !reactions_svg_css_is_dangerous($value);
    }

    // A paint or filter reference (fill="url(#gradient)") may only point inside the file,
    // whichever attribute it is in - including the values an animation sets.
    if(stripos($value, 'url') !== false && reactions_svg_css_is_dangerous($value))
    {
        return false;
    }

    return !reactions_svg_value_is_dangerous($value);
}

/**
 * Whether a link points at something inside the same file: #id and nothing more.
 *
 * @param string $value
 * @return bool
 */
function reactions_svg_is_local_reference($value)
{
    return (bool)preg_match('#^\s*\#[A-Za-z_][\w.:-]*\s*$#', (string)$value);
}
