$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$publicRoot = Join-Path $root 'public'
$dataRoot = Join-Path $root 'data'
$storePath = Join-Path $dataRoot 'reports.json'
$port = if ($env:PORT) { [int]$env:PORT } else { 8765 }
$script:listener = $null

New-Item -ItemType Directory -Force -Path $publicRoot, $dataRoot | Out-Null

function Get-Distance($left, $right) {
    $dx = [double]$left.x - [double]$right.x
    $dy = [double]$left.y - [double]$right.y
    return [math]::Sqrt(($dx * $dx) + ($dy * $dy))
}

function Get-Summary([string]$description) {
    $summary = ($description -replace '\s+', ' ').Trim()
    if ($summary.Length -gt 112) { return ($summary.Substring(0, 109) + '...') }
    return $summary
}

function Get-Analysis($report, $allReports) {
    $nearby = @($allReports | Where-Object {
        $_.reference -ne $report.reference -and (Get-Distance $_.location $report.location) -le 18
    })
    $duplicates = @($nearby | Where-Object {
        $_.category -eq $report.category -and (Get-Distance $_.location $report.location) -le 11
    } | Sort-Object { Get-Distance $_.location $report.location } | Select-Object -First 3 | ForEach-Object {
        [pscustomobject]@{ reference = $_.reference; category = $_.category; area = $_.location.area; summary = $_.summary }
    })
    $text = $report.description.ToLowerInvariant()
    $suggestedCategory = $report.category
    if ($text -match 'overflow|rubbish|trash|waste|bin') { $suggestedCategory = 'Overflowing bins' }
    elseif ($text -match 'water|flood|drain|puddle|waterlog') { $suggestedCategory = 'Waterlogging' }
    elseif ($text -match 'street.?light|lamp|lighting|dark route') { $suggestedCategory = 'Broken streetlight' }
    elseif ($text -match 'pothole|road|manhole|pavement|curb|crossing') { $suggestedCategory = 'Damaged road' }
    $urgency = 1
    if ($text -match 'urgent|immediately|emergency|right now|danger|sparking|live wire|flooded|trapped|injur(?:y|ed)|open manhole|swerving into traffic') { $urgency = 4 }
    elseif ($text -match 'today|blocking|cannot pass|deep water|school|bus stop') { $urgency = 3 }
    elseif ($text -match 'worsening|repeated|overflow|dark|leaking') { $urgency = 2 }
    $safety = 1
    if ($report.category -in @('Damaged road', 'Broken streetlight', 'Waterlogging')) { $safety = 2 }
    if ($text -match 'live wire|sparking|open manhole|injur(?:y|ed)|collision|trapped|deep water|swerving into traffic') { $safety = 4 }
    $related = $nearby.Count
    $impact = [math]::Min(5, [math]::Ceiling($related / 2))
    $relatedPoints = [math]::Min(4, [math]::Floor($related / 4))
    $impactPoints = [math]::Min(3, [math]::Ceiling($related / 5))
    $score = ($urgency * 3) + ($safety * 2) + $relatedPoints + $impactPoints
    $priority = if ($score -ge 25) { 'Critical' } elseif ($score -ge 17) { 'High' } elseif ($score -ge 10) { 'Medium' } else { 'Low' }
    $reason = "$priority priority: urgency $urgency/4, safety risk $safety/4, $related nearby reports, and impact across $([math]::Max(1, $related + 1)) reports."
    return [pscustomobject]@{
        category = $suggestedCategory
        summary = Get-Summary $report.description
        priority = $priority
        priorityScore = $score
        urgency = $urgency
        safetyRisk = $safety
        relatedCount = $related
        impact = [math]::Max(1, $related + 1)
        explanation = $reason
        duplicateMatches = $duplicates
        simulated = $true
    }
}

function Update-Analysis($reports) {
    foreach ($report in $reports) {
        $analysis = Get-Analysis $report $reports
        $report.summary = $analysis.summary
        $report.priority = $analysis.priority
        $report.priorityScore = $analysis.priorityScore
        $report | Add-Member -NotePropertyName analysis -NotePropertyValue $analysis -Force
    }
}

function Save-Reports($reports) {
    $json = ConvertTo-Json -InputObject @($reports) -Depth 20
    Set-Content -LiteralPath $storePath -Value $json -Encoding UTF8
}

function New-SyntheticReport([int]$number) {
    $categories = @('Waterlogging', 'Damaged road', 'Overflowing bins', 'Broken streetlight', 'Waterlogging', 'Other')
    $areas = @('Canal Ward', 'Northbank', 'Market Square', 'Cedar Park', 'Canal Ward', 'Old Quarter')
    $descriptions = @(
        'Rainwater is pooling near the crossing and making the walkway difficult to use.',
        'A deep pothole has opened beside the bus stop; cyclists are swerving into traffic.',
        'The public bins are overflowing and waste is spreading onto the footpath.',
        'The streetlight has been out for several nights on a busy pedestrian route.',
        'Water is collecting beneath the canal underpass after each rainfall.',
        'The curb ramp is damaged and difficult for wheelchair users to cross.'
    )
    $center = switch ($areas[($number - 1) % $areas.Count]) {
        'Canal Ward' { @{ x = 56; y = 41 } }
        'Northbank' { @{ x = 28; y = 29 } }
        'Market Square' { @{ x = 47; y = 59 } }
        'Cedar Park' { @{ x = 76; y = 69 } }
        default { @{ x = 32; y = 70 } }
    }
    $offset = (($number * 7) % 13) - 6
    $category = $categories[($number - 1) % $categories.Count]
    $description = $descriptions[($number - 1) % $descriptions.Count]
    if ($number -in @(3, 9, 15, 21, 27, 33)) {
        $category = 'Waterlogging'
        $description = 'Water is collecting beneath the canal underpass after each rainfall and blocking the accessible path.'
        $center = @{ x = 56; y = 41 }
    }
    if ($number -eq 11) {
        $category = 'Damaged road'
        $description = 'Urgent: a live wire is sparking beside the damaged signal pole near the school crossing. Keep clear.'
        $center = @{ x = 49; y = 55 }
    }
    if ($number -eq 24) {
        $category = 'Damaged road'
        $description = 'A large open manhole is hidden by standing water near the Market Square bus stop. Someone was nearly injured.'
        $center = @{ x = 47; y = 59 }
    }
    $status = if ($number -in @(2, 5, 8, 14, 18, 22, 30, 36)) { 'Resolved' } elseif ($number -in @(6, 12, 17, 26, 34)) { 'In progress' } elseif ($number -in @(4, 10, 19, 28)) { 'Assigned' } elseif ($number -in @(7, 16, 23, 31)) { 'Reviewed' } else { 'New' }
    $created = (Get-Date).AddDays(-(($number * 3) % 18)).AddHours(-($number % 10)).ToUniversalTime().ToString('o')
    $reference = 'CS-26-{0:D4}' -f $number
    $updates = @([pscustomobject]@{ status = 'New'; message = 'Your report has been received and is in the review queue.'; at = $created })
    if ($status -ne 'New') {
        $message = switch ($status) {
            'Reviewed' { 'A service coordinator has reviewed this report.' }
            'Assigned' { 'This report has been assigned to the relevant service team.' }
            'In progress' { 'The service team is working on this issue.' }
            'Resolved' { 'The service team has marked this issue as resolved.' }
        }
        $updates += [pscustomobject]@{ status = $status; message = $message; at = (Get-Date).AddDays(-(($number * 2) % 7)).ToUniversalTime().ToString('o') }
    }
    $owner = if ($status -in @('Assigned', 'In progress', 'Resolved')) { @('Roads team', 'Public works', 'Utilities')[($number - 1) % 3] } else { '' }
    return [pscustomobject]@{
        id = [guid]::NewGuid().ToString()
        reference = $reference
        category = $category
        description = $description
        summary = Get-Summary $description
        priority = 'Medium'
        priorityScore = 0
        status = $status
        createdAt = $created
        updatedAt = $created
        location = [pscustomobject]@{ area = $areas[($number - 1) % $areas.Count]; address = "$($areas[($number - 1) % $areas.Count]) service road"; x = [math]::Max(8, [math]::Min(92, $center.x + $offset)); y = [math]::Max(10, [math]::Min(90, $center.y - $offset)) }
        assignee = $owner
        internalNote = ''
        imageData = ''
        updates = $updates
        synthetic = $true
    }
}

function Read-Reports {
    if (-not (Test-Path -LiteralPath $storePath)) {
        $seed = @()
        for ($number = 1; $number -le 40; $number++) { $seed += New-SyntheticReport $number }
        Update-Analysis $seed
        Save-Reports $seed
        return ,$seed
    }
    $json = Get-Content -LiteralPath $storePath -Raw -Encoding UTF8
    $saved = ConvertFrom-Json -InputObject $json
    Update-Analysis $saved
    return ,$saved
}

function Write-Response($context, [int]$status, [string]$body, [string]$contentType = 'application/json; charset=utf-8') {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $context.Response.StatusCode = $status
    $context.Response.ContentType = $contentType
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.Headers['Cache-Control'] = 'no-store'
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.Close()
}

function Write-Json($context, [int]$status, $value) {
    Write-Response $context $status (ConvertTo-Json -InputObject $value -Depth 20 -Compress)
}

function Get-StatusMessage([string]$status) {
    switch ($status) {
        'Reviewed' { return 'A service coordinator has reviewed this report.' }
        'Assigned' { return 'This report has been assigned to the relevant service team.' }
        'In progress' { return 'The service team is working on this issue.' }
        'Resolved' { return 'The service team has marked this issue as resolved.' }
        default { return 'Your report is in the review queue.' }
    }
}

function Handle-Request($context) {
    $method = $context.Request.HttpMethod.ToUpperInvariant()
    $path = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
    if ($method -eq 'OPTIONS') { Write-Response $context 204 ''; return }

    if ($method -eq 'GET' -and $path -in @('/', '/index.html', '/styles.css', '/app.js')) {
        $file = if ($path -in @('/', '/index.html')) { Join-Path $publicRoot 'index.html' } else { Join-Path $publicRoot $path.TrimStart('/') }
        if (-not (Test-Path -LiteralPath $file)) { Write-Response $context 404 'Not found' 'text/plain; charset=utf-8'; return }
        $type = if ($file.EndsWith('.css')) { 'text/css; charset=utf-8' } elseif ($file.EndsWith('.js')) { 'application/javascript; charset=utf-8' } else { 'text/html; charset=utf-8' }
        $content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
        Write-Response $context 200 $content $type
        return
    }

    if ($method -eq 'GET' -and $path -eq '/api/health') { Write-Json $context 200 @{ status = 'ok'; storage = 'local JSON'; analysis = 'simulated' }; return }
    $reports = Read-Reports

    if ($method -eq 'GET' -and $path -eq '/api/reports') {
        $filtered = @($reports)
        $category = $context.Request.QueryString['category']
        $priority = $context.Request.QueryString['priority']
        $status = $context.Request.QueryString['status']
        $date = $context.Request.QueryString['date']
        if ($category -and $category -ne 'All') { $filtered = @($filtered | Where-Object { $_.category -eq $category }) }
        if ($priority -and $priority -ne 'All') { $filtered = @($filtered | Where-Object { $_.priority -eq $priority }) }
        if ($status -and $status -ne 'All') { $filtered = @($filtered | Where-Object { $_.status -eq $status }) }
        if ($date -eq 'week') { $since = (Get-Date).ToUniversalTime().AddDays(-7); $filtered = @($filtered | Where-Object { [datetime]$_.createdAt -ge $since }) }
        if ($date -eq 'today') { $since = (Get-Date).ToUniversalTime().Date; $filtered = @($filtered | Where-Object { [datetime]$_.createdAt -ge $since }) }
        $filtered = @($filtered | Sort-Object priorityScore -Descending)
        Write-Json $context 200 @{ reports = $filtered; total = $reports.Count; synthetic = $true }
        return
    }

    if ($method -eq 'GET' -and $path -eq '/api/insights') {
        $clusters = @($reports | Group-Object { $_.location.area } | ForEach-Object {
            $items = @($_.Group)
            $open = @($items | Where-Object { $_.status -ne 'Resolved' })
            [pscustomobject]@{ area = $_.Name; count = $items.Count; openCount = $open.Count; urgentCount = @($open | Where-Object { $_.priority -in @('Critical', 'High') }).Count; topCategory = ($items | Group-Object category | Sort-Object Count -Descending | Select-Object -First 1).Name }
        } | Sort-Object count -Descending)
        $top = $clusters | Select-Object -First 1
        $recommendation = switch ($top.topCategory) {
            'Waterlogging' { 'Review drainage at the repeat location and keep pedestrian crossings clear while the issue is assessed.' }
            'Damaged road' { 'Check the highest-risk road defect first and make the hazard visible to people passing through.' }
            'Overflowing bins' { 'Review collection coverage in the area and schedule attention for the most repeated location.' }
            'Broken streetlight' { 'Review lighting along the reported pedestrian routes, prioritizing locations with safety concerns.' }
            default { 'Review the highest-risk report and confirm which local service team should own the next step.' }
        }
        $brief = if ($top) { "$($top.area) has $($top.openCount) open reports, with $($top.urgentCount) high-risk items. $recommendation" } else { 'No active clusters yet.' }
        Write-Json $context 200 @{ hotspots = $clusters; lead = $top; brief = $brief; simulated = $true }
        return
    }

    if ($method -eq 'POST' -and $path -eq '/api/reports') {
        if ($context.Request.ContentLength64 -gt 3500000) { Write-Json $context 413 @{ error = 'Request is too large. Keep image uploads under 2 MB.' }; return }
        $reader = New-Object System.IO.StreamReader($context.Request.InputStream, $context.Request.ContentEncoding)
        $raw = $reader.ReadToEnd()
        try { $body = $raw | ConvertFrom-Json } catch { Write-Json $context 400 @{ error = 'Please send a valid report.' }; return }
        $allowed = @('Waterlogging', 'Damaged road', 'Overflowing bins', 'Broken streetlight', 'Other')
        $description = ([string]$body.description).Trim()
        $area = ([string]$body.location.area).Trim()
        $address = ([string]$body.location.address).Trim()
        if ($body.category -notin $allowed) { Write-Json $context 400 @{ error = 'Choose a listed issue category.' }; return }
        if ($description.Length -lt 12 -or $description.Length -gt 1000) { Write-Json $context 400 @{ error = 'Description must be between 12 and 1,000 characters.' }; return }
        if (-not $area -or $area.Length -gt 80 -or $address.Length -gt 160) { Write-Json $context 400 @{ error = 'Add a valid area and location.' }; return }
        $x = 50.0; $y = 50.0
        if ($null -ne $body.location.x) { $x = [double]$body.location.x }
        if ($null -ne $body.location.y) { $y = [double]$body.location.y }
        if ($x -lt 0 -or $x -gt 100 -or $y -lt 0 -or $y -gt 100) { Write-Json $context 400 @{ error = 'Map pin coordinates must be between 0 and 100.' }; return }
        $latitude = $null; $longitude = $null
        $hasLatitude = $null -ne $body.location.latitude
        $hasLongitude = $null -ne $body.location.longitude
        if ($hasLatitude -ne $hasLongitude) { Write-Json $context 400 @{ error = 'Provide both latitude and longitude.' }; return }
        if ($hasLatitude) {
            try { $latitude = [double]$body.location.latitude; $longitude = [double]$body.location.longitude } catch { Write-Json $context 400 @{ error = 'Device coordinates must be numeric.' }; return }
            if ([double]::IsNaN($latitude) -or [double]::IsInfinity($latitude) -or $latitude -lt -90 -or $latitude -gt 90 -or [double]::IsNaN($longitude) -or [double]::IsInfinity($longitude) -or $longitude -lt -180 -or $longitude -gt 180) { Write-Json $context 400 @{ error = 'Latitude must be between -90 and 90 and longitude between -180 and 180.' }; return }
        }
        $image = [string]$body.imageData
        if ($image -and $image -notmatch '^data:image/(png|jpeg|webp);base64,') { Write-Json $context 400 @{ error = 'Image must be PNG, JPEG, or WebP.' }; return }
        if ($image -and $image.Length -gt 2800000) { Write-Json $context 413 @{ error = 'Image must be smaller than 2 MB.' }; return }
        $next = 1
        foreach ($existing in $reports) { if ($existing.reference -match 'CS-26-(\d+)$') { $next = [math]::Max($next, [int]$Matches[1] + 1) } }
        $reference = 'CS-26-{0:D4}' -f $next
        $now = (Get-Date).ToUniversalTime().ToString('o')
        $location = [pscustomobject]@{ area = $area; address = if ($address) { $address } else { $area }; x = $x; y = $y }
        if ($hasLatitude) {
            $location | Add-Member -NotePropertyName latitude -NotePropertyValue $latitude
            $location | Add-Member -NotePropertyName longitude -NotePropertyValue $longitude
        }
        $report = [pscustomobject]@{
            id = [guid]::NewGuid().ToString(); reference = $reference; category = [string]$body.category; description = $description; summary = Get-Summary $description
            priority = 'Medium'; priorityScore = 0; status = 'New'; createdAt = $now; updatedAt = $now
            location = $location
            assignee = ''; internalNote = ''; imageData = $image; updates = @([pscustomobject]@{ status = 'New'; message = 'Your report has been received and is in the review queue.'; at = $now }); synthetic = $false
        }
        $reports += $report
        Update-Analysis $reports
        Save-Reports $reports
        Write-Json $context 201 @{ report = $report; message = 'Your report is in the review queue.' }
        return
    }

    if ($path -match '^/api/(reports|track)/([^/]+)$' -and $method -eq 'GET') {
        $reference = $Matches[2]
        $report = $reports | Where-Object { $_.reference -ieq $reference -or $_.id -ieq $reference } | Select-Object -First 1
        if (-not $report) { Write-Json $context 404 @{ error = 'We could not find that report. Check the reference and try again.' }; return }
        if ($Matches[1] -eq 'track') {
            $publicLocation = [pscustomobject]@{ area = $report.location.area; address = $report.location.address; x = $report.location.x; y = $report.location.y }
            $publicReport = [pscustomobject]@{ reference = $report.reference; category = $report.category; summary = $report.summary; priority = $report.priority; status = $report.status; createdAt = $report.createdAt; updatedAt = $report.updatedAt; location = $publicLocation; updates = $report.updates; synthetic = $report.synthetic }
            Write-Json $context 200 @{ report = $publicReport }
        } else { Write-Json $context 200 @{ report = $report } }
        return
    }

    if ($method -eq 'PATCH' -and $path -match '^/api/reports/([^/]+)$') {
        $reference = $Matches[1]
        $reader = New-Object System.IO.StreamReader($context.Request.InputStream, $context.Request.ContentEncoding)
        try { $body = $reader.ReadToEnd() | ConvertFrom-Json } catch { Write-Json $context 400 @{ error = 'Please send a valid update.' }; return }
        $report = $reports | Where-Object { $_.reference -ieq $reference -or $_.id -ieq $reference } | Select-Object -First 1
        if (-not $report) { Write-Json $context 404 @{ error = 'Report not found.' }; return }
        if ($body.PSObject.Properties.Name -contains 'assignee') {
            $assignee = ([string]$body.assignee).Trim()
            if ($assignee.Length -gt 80) { Write-Json $context 400 @{ error = 'Owner name must be 80 characters or fewer.' }; return }
            $report.assignee = $assignee
        }
        if ($body.PSObject.Properties.Name -contains 'internalNote') {
            $note = ([string]$body.internalNote).Trim()
            if ($note.Length -gt 500) { Write-Json $context 400 @{ error = 'Internal notes must be 500 characters or fewer.' }; return }
            $report.internalNote = $note
        }
        if ($body.PSObject.Properties.Name -contains 'status') {
            $validStatuses = @('New', 'Reviewed', 'Assigned', 'In progress', 'Resolved')
            if ($body.status -notin $validStatuses) { Write-Json $context 400 @{ error = 'Choose a valid workflow status.' }; return }
            if ($body.status -in @('Assigned', 'In progress', 'Resolved') -and -not $report.assignee) { Write-Json $context 400 @{ error = 'Assign an owner or team before advancing this report.' }; return }
            if ($body.status -ne $report.status) {
                $report.status = [string]$body.status
                $now = (Get-Date).ToUniversalTime().ToString('o')
                $report.updatedAt = $now
                $report.updates += [pscustomobject]@{ status = $report.status; message = Get-StatusMessage $report.status; at = $now }
            }
        }
        Update-Analysis $reports
        Save-Reports $reports
        Write-Json $context 200 @{ report = $report }
        return
    }

    Write-Json $context 404 @{ error = 'Endpoint not found.' }
}

$script:listener = New-Object System.Net.HttpListener
$script:listener.Prefixes.Add("http://127.0.0.1:$port/")
$script:listener.Start()
Write-Host "CivicSignal is running at http://127.0.0.1:$port"
Write-Host 'Press Ctrl+C to stop the server.'
while ($script:listener.IsListening) {
    try {
        $context = $script:listener.GetContext()
        try { Handle-Request $context } catch {
            Write-Warning $_.Exception.Message
            try { Write-Json $context 500 @{ error = 'The server could not complete that request.' } } catch { }
        }
    } catch {
        if ($script:listener.IsListening) { Write-Warning $_.Exception.Message }
    }
}
