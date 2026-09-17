<?php
/**
 * Form handler for the static build of fitroofingco.com.
 *
 * Ported from the same handler on the In The Light Roofing static publish
 * (in-the-light-roofing-website, branch `deploy`, _forms/submit.php), adapted
 * for Elementor Pro's field naming and for the fact that this site has no file
 * uploads on any form.
 *
 * Every enquiry form on this site posts here. The three pages that carry one
 * (/, /home-2/, /contact/) have had action="/_forms/submit.php" added and the
 * Elementor Pro form widget's handler disabled, because that handler hijacked
 * the submit and sent it to /wp-admin/admin-ajax.php, which does not exist on
 * a static host.
 *
 * THIS FILE NEEDS A HOST THAT RUNS PHP. On a static-only host (GitHub Pages,
 * Netlify, Cloudflare Pages) this file is served as text or 404s and the
 * enquiry is lost. See the switchover preflight note before go-live.
 */

// Never show a PHP notice to a visitor; the host's error log is where they go.
ini_set('display_errors', '0');
error_reporting(E_ALL);

// The business is in Dallas / Fort Worth, so the timestamp in the notification
// is written in the hours the person reading it keeps.
date_default_timezone_set('America/Chicago');

// The only address the build itself names: 10 mailto: links across the pages.
$TO = 'info@fitroofingco.com';
$FROM = 'Fit Roofing & Construction website <info@fitroofingco.com>';

// form_id -> Elementor field key -> the label the visitor actually saw.
// Harvested from the three published pages, not invented.
$FIELDS = [
    // Homepage, /
    '8961e59' => [
        'name'          => 'Name',
        'field_e68902c' => 'Phone',
        'field_2ed8f84' => 'Address',
        'message'       => 'Message',
    ],
    // /home-2/
    'bddb309' => [
        'name'          => 'Name',
        'field_e68902c' => 'Phone',
        'field_2ed8f84' => 'Address',
        'message'       => 'Message',
    ],
    // /contact/
    '3e18832' => [
        'name'          => 'Name',
        'field_e68902c' => 'Phone',
        'email'         => 'Email',
        'field_2ed8f84' => 'Address',
        'message'       => 'Message',
    ],
];

// Posted with every form and never worth repeating in the email. post_id,
// queried_id and referer_title are Elementor's plumbing, baked into the mirror
// at capture time; fit_page and company_website are ours.
$MACHINE = ['post_id', 'form_id', 'queried_id', 'referer_title', 'action',
    'referrer', 'fit_page', 'company_website', '_wpnonce'];

/**
 * A path on this site, or null. Everything that reaches a Location header goes
 * through here first: an absolute URL, a protocol-relative "//elsewhere" or a
 * header-splitting newline is refused outright rather than cleaned up, because
 * a redirector that tries to repair hostile input is how open redirects happen.
 */
function fit_local_path($url) {
    if (!is_string($url) || $url === '') {
        return null;
    }
    $path = parse_url($url, PHP_URL_PATH);
    if (!is_string($path) || $path === '' || $path[0] !== '/' || substr($path, 0, 2) === '//') {
        return null;
    }
    if (preg_match('#[^A-Za-z0-9/_.~%:@!$&()*+,;=-]#', $path)) {
        return null;
    }
    return $path;
}

/**
 * The page the visitor was on, so the redirect puts them back where they were.
 * HTTP_REFERER first; the fit_page field stamped into the markup is the
 * fallback for browsers and privacy settings that send no referer at all.
 */
function fit_page() {
    $host = isset($_SERVER['HTTP_HOST']) ? preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST']) : '';
    $ref = isset($_SERVER['HTTP_REFERER']) ? $_SERVER['HTTP_REFERER'] : '';
    if (is_string($ref) && $ref !== '') {
        $parts = parse_url($ref);
        $refHost = (is_array($parts) && isset($parts['host'])) ? $parts['host'] : '';
        if ($refHost === '' || ($host !== '' && strcasecmp($refHost, $host) === 0)) {
            $path = fit_local_path($ref);
            if ($path !== null) {
                return $path;
            }
        }
    }
    // The markup stamps a bare path and nothing else, so a value carrying a
    // scheme or a host did not come from the markup and is not trusted to name
    // the page. Refused rather than reduced to its path: a
    // "//elsewhere.example/contact/" would otherwise pass as "/contact/".
    $raw = isset($_POST['fit_page']) ? $_POST['fit_page'] : '';
    if (is_string($raw) && $raw !== '' && $raw[0] === '/' && substr($raw, 0, 2) !== '//') {
        $stamped = fit_local_path($raw);
        if ($stamped !== null) {
            return $stamped;
        }
    }
    return '/';
}

/** 303, so the browser turns the POST into a GET and a refresh cannot resubmit. */
function fit_redirect($path) {
    header('Cache-Control: no-store');
    header('Location: ' . $path, true, 303);
    exit;
}

/** Back to the page, with the flag the page's own script turns into a message. */
function fit_finish($page, $state) {
    fit_redirect($page . (strpos($page, '?') === false ? '?' : '&') . 'enquiry=' . $state);
}

/** Multi-line text with the control characters and the stray carriage returns taken out. */
function fit_text($value) {
    if (!is_string($value)) {
        return '';
    }
    $value = str_replace(["\0", "\r\n", "\r"], ['', "\n", "\n"], $value);
    $value = preg_replace('/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $value);
    return trim($value);
}

/** One line of text. Also what makes a value safe to put in a mail header. */
function fit_line($value) {
    return trim(str_replace("\n", ' ', fit_text($value)));
}

/** Cut to a byte length without splitting a UTF-8 character in half. */
function fit_cut($value, $max) {
    if (strlen($value) <= $max) {
        return $value;
    }
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $max, 'UTF-8');
    }
    return preg_replace('/[\x80-\xBF]*$/', '', substr($value, 0, $max));
}

/* ------------------------------------------------------------------------ */

if (!isset($_SERVER['REQUEST_METHOD']) || strtoupper($_SERVER['REQUEST_METHOD']) !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    header('Content-Type: text/plain; charset=UTF-8');
    echo "This address accepts form submissions only.\n";
    exit;
}

$page = fit_page();

// A post larger than the host's post_max_size arrives with $_POST emptied and
// no warning of its own. Say so here rather than letting it fall through and
// look like an empty form.
if (empty($_POST) && isset($_SERVER['CONTENT_LENGTH']) && (int) $_SERVER['CONTENT_LENGTH'] > 0) {
    fit_finish($page, 'error');
}

// The bot trap, before any validation. A filled-in honeypot gets the same
// answer a real submission gets, so nothing is learned from the difference.
if (fit_line(isset($_POST['company_website']) ? $_POST['company_website'] : '') !== '') {
    fit_finish($page, 'sent');
}

// Elementor posts its fields as form_fields[key], so PHP hands them over as an
// array. Anything else under that name is not from one of our forms.
$posted = isset($_POST['form_fields']) && is_array($_POST['form_fields']) ? $_POST['form_fields'] : [];

$get = function ($key) use ($posted) {
    return (isset($posted[$key]) && is_string($posted[$key])) ? $posted[$key] : '';
};

$name  = fit_cut(fit_line($get('name')), 200);
$phone = fit_cut(fit_line($get('field_e68902c')), 200);
$email = fit_cut(fit_line($get('email')), 250);

// One way to answer the person. Without a phone or an email the enquiry cannot
// be actioned at all, so it is refused here rather than mailed and ignored.
// The markup makes the browser ask for this first, so reaching this line means
// the submission did not come from one of our forms in a normal browser.
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    fit_finish($page, 'error');
}
if ($phone === '' && $email === '') {
    fit_finish($page, 'error');
}

$formId = preg_replace('/[^0-9a-z]/', '', strtolower(fit_line(isset($_POST['form_id']) ? $_POST['form_id'] : '')));
$known = isset($FIELDS[$formId]) ? $FIELDS[$formId] : [];

/* ---------------------------------------------------------------- the body */

$inline = [];
$blocks = [];
$seen = [];

// The form's own fields first, in the order they appear on the page, labelled
// the way the page labels them.
foreach ($known as $field => $label) {
    $seen[$field] = true;
    $value = fit_cut(fit_text($get($field)), 20000);
    if ($value === '') {
        continue;
    }
    if (strpos($value, "\n") === false) {
        $inline[] = [$label, $value];
    } else {
        $blocks[] = [$label, $value];
    }
}

// Anything a form grows later still reaches the inbox, under its own name.
foreach ($posted as $field => $value) {
    if (isset($seen[$field]) || !is_string($field) || !is_string($value)) {
        continue;
    }
    $value = fit_cut(fit_text($value), 20000);
    if ($value === '') {
        continue;
    }
    if (strpos($value, "\n") === false) {
        $inline[] = [$field, $value];
    } else {
        $blocks[] = [$field, $value];
    }
}

// And any top-level field that is not Elementor's or our own plumbing.
foreach ($_POST as $field => $value) {
    if (!is_string($field) || !is_string($value) || in_array($field, $MACHINE, true)) {
        continue;
    }
    $value = fit_cut(fit_text($value), 20000);
    if ($value === '') {
        continue;
    }
    if (strpos($value, "\n") === false) {
        $inline[] = [$field, $value];
    } else {
        $blocks[] = [$field, $value];
    }
}

/* ---------------------------------------------------------------- the mail */

$width = 0;
foreach ($inline as $row) {
    $width = max($width, strlen($row[0]));
}
$width = max($width, 9);

$body = 'New enquiry from ' . $page . "\n\n";
foreach ($inline as $row) {
    $body .= str_pad($row[0] . ':', $width + 2) . $row[1] . "\n";
}
foreach ($blocks as $row) {
    $body .= "\n" . $row[0] . "\n" . str_repeat('-', strlen($row[0])) . "\n" . $row[1] . "\n";
}
$body .= "\n" . str_repeat('-', 40) . "\n";
$body .= str_pad('Page:', $width + 2) . $page . "\n";
$body .= str_pad('Received:', $width + 2) . date('Y-m-d H:i:s T') . "\n";
if (isset($_SERVER['REMOTE_ADDR'])) {
    $body .= str_pad('From IP:', $width + 2) . fit_line($_SERVER['REMOTE_ADDR']) . "\n";
}

$subject = fit_line('Fit Roofing website enquiry from ' . $page);

$headers = ['From: ' . $FROM];
if ($email !== '') {
    // So hitting reply answers the person who filled the form in.
    $headers[] = 'Reply-To: ' . fit_line($email);
}
$headers[] = 'MIME-Version: 1.0';
$headers[] = 'Content-Type: text/plain; charset=UTF-8';
// base64 rather than 8bit: it is the only encoding that cannot be tripped up
// by a long line or by a mail server that rewrites one.
$headers[] = 'Content-Transfer-Encoding: base64';

$message = chunk_split(base64_encode($body), 76, "\r\n");

if (!mail($TO, $subject, $message, implode("\r\n", $headers))) {
    fit_finish($page, 'error');
}

fit_finish($page, 'sent');
