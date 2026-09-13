var LOGO_CACHE_KEY = 'gb_logo_cache';
var logoCache = JSON.parse(localStorage.getItem(LOGO_CACHE_KEY) || '{}');
var flagCache = {};
var pendingLogos = [];

var TEAM_LOGOS = {
  'hakoah sydney city east fc': 'https://upload.wikimedia.org/wikipedia/en/0/0c/Hakoah_Sydney_City_East_FC.png',
  'hurstville zagreb fc': 'https://upload.wikimedia.org/wikipedia/en/8/85/Hurstville_zagreb.jpg',
  'hurstville zfc': 'https://upload.wikimedia.org/wikipedia/en/8/85/Hurstville_zagreb.jpg',
  'fc bulleen lions': 'https://tmssl.akamaized.net/images/wappen/head/25908.png?lm=1456913310',
  'bulleen lions': 'https://tmssl.akamaized.net/images/wappen/head/25908.png?lm=1456913310',
  'brunswick juventus': 'https://tmssl.akamaized.net/images/wappen/homepage/35995.png?lm=1728508485',
  'brunswick juventus fc': 'https://tmssl.akamaized.net/images/wappen/homepage/35995.png?lm=1728508485',
  'fc melbourne srbija': 'https://fcmelbourne.com.au/cdn/shop/files/logo.svg?v=1688184378',
  'melbourne srbija': 'https://fcmelbourne.com.au/cdn/shop/files/logo.svg?v=1688184378',
  'prospect united sc': 'https://static.wixstatic.com/media/126306_b603f8bad8074682a442e068976d388b~mv2.png',
  'prospect united': 'https://static.wixstatic.com/media/126306_b603f8bad8074682a442e068976d388b~mv2.png',
  'prospect united fc': 'https://static.wixstatic.com/media/126306_b603f8bad8074682a442e068976d388b~mv2.png',
  'eastern united fc': 'https://tmssl.akamaized.net/images/wappen/head/107735.png?lm=1680727731',
  'eastern united': 'https://tmssl.akamaized.net/images/wappen/head/107735.png?lm=1680727731',
  'stjarnan': 'https://upload.wikimedia.org/wikipedia/commons/c/cf/Stjarnan_Logo.png',
  'stjarnan fc': 'https://upload.wikimedia.org/wikipedia/commons/c/cf/Stjarnan_Logo.png',
  'stjarnan men\'s football': 'https://upload.wikimedia.org/wikipedia/commons/c/cf/Stjarnan_Logo.png',
  'caboolture sfc': 'https://tmssl.akamaized.net/images/wappen/head/123902.png?lm=1729549761',
  'caboolture sports fc': 'https://tmssl.akamaized.net/images/wappen/head/123902.png?lm=1729549761',
  'caboolture sports football club': 'https://tmssl.akamaized.net/images/wappen/head/123902.png?lm=1729549761',
  'northcote city fc': 'https://upload.wikimedia.org/wikipedia/en/c/c8/Northcote_City_FC_logo.png',
  'northcote city': 'https://upload.wikimedia.org/wikipedia/en/c/c8/Northcote_City_FC_logo.png',
  'green gully': 'https://tmssl.akamaized.net/images/wappen/head/11342.png?lm=1677097278',
  'green gully sc': 'https://tmssl.akamaized.net/images/wappen/head/11342.png?lm=1677097278',
  'green gully soccer club': 'https://tmssl.akamaized.net/images/wappen/head/11342.png?lm=1677097278',
  'holland park hawks': 'https://tmssl.akamaized.net/images/wappen/head/49090.png?lm=1471127812',
  'holland park hawks fc': 'https://tmssl.akamaized.net/images/wappen/head/49090.png?lm=1471127812',
  'holland park hawks sc': 'https://tmssl.akamaized.net/images/wappen/head/49090.png?lm=1471127812',
  'san antonio fc': 'https://tmssl.akamaized.net/images/wappen/head/52910.png?lm=1456506487',
  'san antonio fútbol club': 'https://tmssl.akamaized.net/images/wappen/head/52910.png?lm=1456506487',
  'san antonio': 'https://tmssl.akamaized.net/images/wappen/head/52910.png?lm=1456506487',
};

var GITHUB_LOGOS_KEY = 'gb_github_logos_v2';
var gitHubLogoMap = null;

function initGithubLogoMap() {
  if (gitHubLogoMap) return Promise.resolve(gitHubLogoMap);
  try {
    var cached = sessionStorage.getItem(GITHUB_LOGOS_KEY);
    if (cached) { gitHubLogoMap = JSON.parse(cached); return Promise.resolve(gitHubLogoMap); }
  } catch(e) {}
  return fetch('https://api.github.com/repos/luukhopman/football-logos/git/trees/master')
    .then(function(r){ if(!r.ok)throw Error('root'); return r.json(); })
    .then(function(root){
      var logosEntry = null;
      (root.tree||[]).forEach(function(e){ if(e.path==='logos') logosEntry=e; });
      if (!logosEntry) throw Error('no logos');
      return fetch(logosEntry.url + '?recursive=1');
    })
    .then(function(r){ if(!r.ok)throw Error('logos'); return r.json(); })
    .then(function(tree){
      var map = {};
      (tree.tree||[]).forEach(function(entry){
        if (entry.type!=='blob' || !/\.png$/i.test(entry.path)) return;
        var parts = entry.path.split('/');
        if (parts.length<2) return;
        var league = parts[0], filename = parts.slice(1).join('/').replace(/\.png$/i,'');
        var lcName = filename.toLowerCase().trim();
        var url = 'https://raw.githubusercontent.com/luukhopman/football-logos/master/logos/' + encodeURIComponent(league) + '/' + encodeURIComponent(filename) + '.png';
        map[lcName] = {league:league, url:url};
        var cleaned = lcName.replace(/\s+(fc|afc|cf|sc|ssc|ac|as|rs|rc|fk|sk|ca|ud|cd|cfd|sc|fcv|kv|rsc|kaa|krc|kv|oh|sco|los|og|gnk|hnk|nk|sl|cp|aif|bk|if|il)\s*$/,'').replace(/^(fc|afc|ac|as|rs|rc|fk|sk|ca|ud|cd|gnk|hnk|nk|sc|sl|cp|kv|bk|if|ik|il)\s+/,'').replace(/\s+fc\s*$/,'').trim();
        if (cleaned && cleaned !== lcName && !map[cleaned]) map[cleaned] = map[lcName];
        var stripped = lcName.replace(/[äåàáâãæ]/g,'a').replace(/[ëèéê]/g,'e').replace(/[ïìíî]/g,'i').replace(/[öòóôõ]/g,'o').replace(/[üùúû]/g,'u').replace(/[ýÿ]/g,'y').replace(/ñ/g,'n').replace(/ç/g,'c').replace(/ß/g,'ss').replace(/ø/g,'o').replace(/æ/g,'ae');
        if (stripped !== lcName && !map[stripped]) map[stripped] = map[lcName];
      });
      gitHubLogoMap = map;
      try { sessionStorage.setItem(GITHUB_LOGOS_KEY, JSON.stringify(map)); } catch(e) {}
      return map;
    })
    .catch(function(){ gitHubLogoMap = {}; return gitHubLogoMap; });
}

var LEAGUE_DIR_MAP = (function(){
  var m = {};
  function add(names, dir) { names.forEach(function(n){ m[n.toLowerCase()]=dir; }); }
  add(['premier league','english premier league','epl','liga inggris','english'],'England - Premier League');
  add(['la liga','laliga','spain','spanish','liga spanyol'],'Spain - LaLiga');
  add(['serie a','italy','italian','liga italia','italy serie a'],'Italy - Serie A');
  add(['bundesliga','germany','german','liga jerman','germany bundesliga'],'Germany - Bundesliga');
  add(['ligue 1','france','french','liga prancis','france ligue 1'],'France - Ligue 1');
  add(['eredivisie','netherlands','dutch','liga belanda'],'Netherlands - Eredivisie');
  add(['liga portugal','portugal','portuguese','primeira liga'],'Portugal - Liga Portugal');
  add(['champions league','ucl'],'Europe - Champions League');
  add(['europa league','uel'],'Europe - Europa League');
  add(['europa conference league','uecl','conference league'],'Europe - Europa Conference League');
  add(['serie a brazil','brasileirao','brazil serie a','brazilian'],'Brazil - Série A');
  add(['liga mx','mexico','mexican','liga mx'],'Mexico - Liga MX');
  add(['mls','usa','united states'],'USA - MLS');
  add(['super lig','turkey','turkish','super lig'],'Türkiye - Süper Lig');
  add(['jupiler pro league','belgium','belgian'],'Belgium - Jupiler Pro League');
  add(['premiership','scottish','scotland'],'Scotland - Scottish Premiership');
  add(['super league','greece','greek'],'Greece - Super League 1');
  add(['swiss super league','switzerland','swiss'],'Switzerland - Super League');
  add(['austrian bundesliga','austria'],'Austria - Bundesliga');
  add(['superliga','denmark','danish','denmark superliga'],'Denmark - Superliga');
  add(['allsvenskan','sweden','swedish'],'Sweden - Allsvenskan');
  add(['eliteserien','norway','norwegian'],'Norway - Eliteserien');
  add(['ekstraklasa','poland','polish'],'Poland - PKO BP Ekstraklasa');
  add(['chance liga','czech','czech republic'],'Czech Republic - Chance Liga');
  add(['super sport hnl','croatia','croatian','hnl'],'Croatia - SuperSport HNL');
  add(['liga i','romania','romanian'],'Romania - SuperLiga');
  add(['nb i','hungary','hungarian','nb i'],'Hungary - NB I');
  add(['super liga','serbia','serbian','super liga srbije'],'Serbia - Super liga Srbije');
  add(['premier liga','russia','russian','russian premier league','russian premier liga'],'Russia - Premier Liga');
  add(['ukrainian premier league','ukraine','ukrainian'],'Ukraine - Premier Liga');
  add(['ligat haal','israel','israeli'],'Israel - Ligat ha\'Al');
  add(['efbet liga','bulgaria','bulgarian'],'Bulgaria - efbet Liga');
  return m;
})();

function getLeagueDir(leagueName) {
  if (!leagueName) return null;
  var lower = leagueName.toLowerCase().trim();
  if (LEAGUE_DIR_MAP[lower]) return LEAGUE_DIR_MAP[lower];
  for (var key in LEAGUE_DIR_MAP) { if (lower.indexOf(key) !== -1) return LEAGUE_DIR_MAP[key]; }
  return null;
}

function _sD(s) {
  return s.replace(/[äåàáâãæ]/g,'a').replace(/[ëèéê]/g,'e').replace(/[ïìíî]/g,'i').replace(/[öòóôõ]/g,'o').replace(/[üùúû]/g,'u').replace(/[ýÿ]/g,'y').replace(/ñ/g,'n').replace(/ç/g,'c').replace(/ß/g,'ss').replace(/ø/g,'o').replace(/æ/g,'ae');
}
function _cleanKey(s) {
  return _sD(s).replace(/[^a-z0-9 &.'-]/g,' ').replace(/\s+/g,' ').trim();
}

function findGithubLogo(teamName, leagueName) {
  if (!gitHubLogoMap || !Object.keys(gitHubLogoMap).length) return null;
  var key = teamName.toLowerCase().trim();
  // Exact match
  if (gitHubLogoMap[key]) return gitHubLogoMap[key].url;
  // Try with FC suffix
  if (gitHubLogoMap[key + ' fc']) return gitHubLogoMap[key + ' fc'].url;
  // Try without common prefix
  var noPrefix = key.replace(/^(fc|afc|ac|as|rs|rc|fk|sk|ca|ud|cd|gnk|hnk|nk|sc|sl|cp|kv|ssc|gais|bk|if|ik|mj|il|sco|los|og|bsc|tsg|vfl|vfb|aif|if)\s+/,'');
  if (noPrefix !== key && gitHubLogoMap[noPrefix]) return gitHubLogoMap[noPrefix].url;
  // Try clean version (diacritics stripped)
  var clean = _cleanKey(key);
  if (clean !== key) {
    if (gitHubLogoMap[clean]) return gitHubLogoMap[clean].url;
    if (gitHubLogoMap[clean + ' fc']) return gitHubLogoMap[clean + ' fc'].url;
  }
  // Try googling by iterating ALL keys (diacritics-aware)
  for (var k in gitHubLogoMap) {
    var kClean = _cleanKey(k);
    if (kClean === clean) return gitHubLogoMap[k].url;
  }
  // League-scoped fuzzy match
  var dir = getLeagueDir(leagueName);
  if (dir) {
    var bestMatch = null, bestScore = 0;
    for (var k in gitHubLogoMap) {
      if (gitHubLogoMap[k].league !== dir) continue;
      var lc = _cleanKey(k);
      if (lc === clean) return gitHubLogoMap[k].url;
      var contains = lc.indexOf(clean) !== -1 || clean.indexOf(lc) !== -1;
      var words = clean.split(' ');
      var wordMatch = words.length > 1 && words.filter(function(w){ return w.length > 2 && lc.indexOf(w) !== -1; }).length >= Math.ceil(words.length * 0.6);
      if (contains || wordMatch) {
        var score = Math.min(clean.length, lc.length) / Math.max(clean.length, lc.length);
        if (score > bestScore) { bestScore = score; bestMatch = gitHubLogoMap[k].url; }
      }
    }
    if (bestMatch && bestScore > 0.3) return bestMatch;
  }
  return null;
}

var COUNTRY_FLAGS = {
  'england': 'GB-ENG','english': 'GB-ENG','premier league': 'GB-ENG','epl': 'GB-ENG',
  'spain': 'ES','spanish': 'ES','la liga': 'ES',
  'italy': 'IT','italian': 'IT','serie a': 'IT',
  'germany': 'DE','german': 'DE','bundesliga': 'DE',
  'france': 'FR','french': 'FR','ligue 1': 'FR',
  'netherlands': 'NL','dutch': 'NL','eredivisie': 'NL',
  'portugal': 'PT','portuguese': 'PT','liga portugal': 'PT',
  'brazil': 'BR','brazilian': 'BR','serie a brazil': 'BR',
  'argentina': 'AR','argentinian': 'AR',
  'japan': 'JP','japanese': 'JP','j league': 'JP',
  'china': 'CN','chinese': 'CN','super league': 'CN',
  'australia': 'AU','australian': 'AU','a league': 'AU',
  'usa': 'US','united states': 'US','mls': 'US',
  'mexico': 'MX','mexican': 'MX','liga mx': 'MX',
  'turkey': 'TR','turkish': 'TR','super lig': 'TR',
  'belgium': 'BE','belgian': 'BE','pro league': 'BE',
  'switzerland': 'CH','swiss': 'CH','super league': 'CH',
  'austria': 'AT','austrian': 'AT','bundesliga': 'AT',
  'scotland': 'GB-SCT','scottish': 'GB-SCT','premiership': 'GB-SCT',
  'russia': 'RU','russian': 'RU','premier league': 'RU',
  'ukraine': 'UA','ukrainian': 'UA','premier league': 'UA',
  'poland': 'PL','polish': 'PL','ekstraklasa': 'PL',
  'croatia': 'HR','croatian': 'HR','h nl': 'HR',
  'denmark': 'DK','danish': 'DK','superliga': 'DK',
  'sweden': 'SE','swedish': 'SE','allsvenskan': 'SE',
  'norway': 'NO','norwegian': 'NO','eliteserien': 'NO',
  'greece': 'GR','greek': 'GR','super league': 'GR',
  'czech': 'CZ','czech republic': 'CZ','czechia': 'CZ','first league': 'CZ',
  'romania': 'RO','romanian': 'RO','liga i': 'RO',
  'bulgaria': 'BG','bulgarian': 'BG','first league': 'BG',
  'hungary': 'HU','hungarian': 'HU','nb i': 'HU',
  'serbia': 'RS','serbian': 'RS','super liga': 'RS',
  'south korea': 'KR','korea': 'KR','k league': 'KR',
  'saudi arabia': 'SA','saudi': 'SA','pro league': 'SA',
  'qatar': 'QA','qatari': 'QA','stars league': 'QA',
  'egypt': 'EG','egyptian': 'EG','premier league': 'EG',
  'morocco': 'MA','moroccan': 'MA','botola': 'MA',
  'tunisia': 'TN','tunisian': 'TN','ligue 1': 'TN',
  'south africa': 'ZA','south african': 'ZA','psl': 'ZA',
  'nigeria': 'NG','nigerian': 'NG','professional league': 'NG',
  'india': 'IN','indian': 'IN','super league': 'IN',
  'thailand': 'TH','thai': 'TH','thai league': 'TH',
  'vietnam': 'VN','vietnamese': 'VN','v league': 'VN',
  'indonesia': 'ID','indonesian': 'ID','liga 1': 'ID',
  'malaysia': 'MY','malaysian': 'MY','super league': 'MY',
  'singapore': 'SG','singaporean': 'SG','premier league': 'SG',
  'philippines': 'PH','filipino': 'PH','pfl': 'PH',
  'iran': 'IR','iranian': 'IR','persian gulf': 'IR','pro league': 'IR',
  'iraq': 'IQ','iraqi': 'IQ','stars league': 'IQ',
  'israel': 'IL','israeli': 'IL','premier league': 'IL',
  'uae': 'AE','united arab emirates': 'AE','arabian gulf': 'AE',
  'colombia': 'CO','colombian': 'CO','primera a': 'CO',
  'chile': 'CL','chilean': 'CL','primera division': 'CL',
  'peru': 'PE','peruvian': 'PE','liga 1': 'PE',
  'uruguay': 'UY','uruguayan': 'UY','primera division': 'UY',
  'paraguay': 'PY','paraguayan': 'PY','primera division': 'PY',
  'ecuador': 'EC','ecuadorian': 'EC','serie a': 'EC',
  'bolivia': 'BO','bolivian': 'BO','division profesional': 'BO',
  'venezuela': 'VE','venezuelan': 'VE','primera division': 'VE',
  'costa rica': 'CR','costa rican': 'CR','primera division': 'CR',
  'honduras': 'HN','honduran': 'HN','liga nacional': 'HN',
  'el salvador': 'SV','salvadoran': 'SV','primera division': 'SV',
  'guatemala': 'GT','guatemalan': 'GT','liga nacional': 'GT',
  'panama': 'PA','panamanian': 'PA','lpf': 'PA',
  'jamaica': 'JM','jamaican': 'JM','premier league': 'JM',
  'canada': 'CA','canadian': 'CA','cpl': 'CA',
  'new zealand': 'NZ','new zealander': 'NZ','national league': 'NZ',
  'world cup': 'FIFA','euro': 'UEFA','champions league': 'UEFA','europa league': 'UEFA',
  'uefa': 'UEFA','fifa': 'FIFA','afc': 'AFC','caf': 'CAF','concacaf': 'CONCACAF','conmebol': 'CONMEBOL','ofa': 'OFC'
};

function detectCountryFlag(leagueName, teamName) {
  var text = (leagueName + ' ' + teamName).toLowerCase();
  var best = null, bestLen = 0;
  for (var key in COUNTRY_FLAGS) {
    if (text.indexOf(key) !== -1 && key.length > bestLen) {
      best = COUNTRY_FLAGS[key];
      bestLen = key.length;
    }
  }
  return best;
}

function getFlagUrl(countryCode) {
  if (!countryCode) return '';
  return 'https://flagcdn.com/24x18/' + countryCode.toLowerCase() + '.png';
}

async function fetchLogoBatch(teamNames, onProgress) {
  if (!teamNames.length) return;
  var needed = [];
  teamNames.forEach(function(name){
    var key = name.toLowerCase().trim();
    if (!(key in logoCache)) needed.push(name);
  });
  if (!needed.length) return;

  for (var i = 0; i < needed.length; i++) {
    await new Promise(function(r) { setTimeout(r, 50); });
    try {
      var r = await fetch('https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=' + encodeURIComponent(needed[i]));
      var d = await r.json();
      if (d && d.teams && d.teams.length) {
        var query = needed[i].toLowerCase().trim();
        var best = null, bestScore = 0;
        d.teams.forEach(function(t){
          var name = (t.strTeam || t.strAlternate || '').toLowerCase().trim();
          var score = 0;
          if (name === query) score = 100;
          else if (name.indexOf(query) !== -1 || query.indexOf(name) !== -1) score = 50;
          else {
            var qWords = query.split(/\s+/);
            var nWords = name.split(/\s+/);
            var common = qWords.filter(function(w){ return w.length > 1 && nWords.indexOf(w) !== -1; }).length;
            if (common >= Math.min(qWords.length, nWords.length) * 0.5) score = 30;
          }
          if (score > bestScore) { bestScore = score; best = t; }
        });
        if (!best) best = d.teams[0];
        var team = best;
        var url = team.strBadge || team.strLogo || team.strTeamBadge || team.strTeamLogo || null;
        if (team.strAlternate) logoCache[team.strAlternate.toLowerCase()] = url;
        logoCache[query] = url;
      }
    } catch(e) {}
    if (onProgress && (i % 3 === 0 || i === needed.length - 1)) onProgress();
  }
  persistLogoCache();
}

function persistLogoCache() {
  try { localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(logoCache)); } catch(e) {}
}

var CONFIG_KEY = 'gb_site_config';

function getDefaultConfig() {
  return {
    name:'BANDAR80',
    logo:'https://bandar71.com/resources/images/logo.png',
    color:'#00BFFF'
  };
}

function loadConfig() {
  try {
    var raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.name && parsed.logo && parsed.color) return parsed;
    }
  } catch(e){}
  return getDefaultConfig();
}

function saveConfig(cfg) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch(e){}
}

function getSiteConfig() {
  var cfg = loadConfig();
  return {
    name: cfg.name,
    logo: cfg.logo,
    marquee: 'PREDIKSI BOLA TERUPDATE ! Daftar di ' + cfg.name + '!',
    cssVars: {'--g': cfg.color}
  };
}

var leaguesData = [];

function cleanName(name) {
  return name.replace(/\[\s*W\s*\]/gi,'').replace(/\(\s*W\s*\)/gi,'').replace(/\[\s*[nN]\s*\]/g,'').replace(/\bU\s*1[0-9]\b/gi,'').replace(/\bU\s*2[0-3]\b/gi,'').replace(/\(U\s*\d{2}\)/gi,'').replace(/\bSenior\b/gi,'').replace(/\bJunior\b/gi,'').replace(/\s+/g,' ').trim();
}

function getLogoUrl(teamName, leagueName) {
  var key = teamName.toLowerCase().trim();
  var clean = cleanName(teamName).toLowerCase().trim();
  var manual = TEAM_LOGOS[key];
  if (manual) return manual;
  if (clean !== key) {
    manual = TEAM_LOGOS[clean];
    if (manual) return manual;
  }
  var cached = logoCache[key];
  if (cached) return cached;
  if (clean !== key && logoCache[clean]) return logoCache[clean];
  var gh = findGithubLogo(teamName, leagueName);
  if (gh) return gh;
  return makeSVG(teamName);
}

function getFlagForTeam(leagueName, teamName) {
  var cc = detectCountryFlag(leagueName, teamName);
  return cc ? getFlagUrl(cc) : '';
}

function makeSVG(teamName) {
  var words = teamName.replace(/[^a-zA-Z\s]/g,' ').trim().split(/\s+/).filter(function(w){ return w.length > 0; });
  var initials = words.map(function(w){ return w[0].toUpperCase(); }).join('').substring(0,3) || 'TM';
  var colors = ['#10B981','#34D399','#F59E0B','#0EA5E9','#F43F5E','#8B5CF6','#EC4899','#14B8A6','#F97316','#06B6D4'];
  var hash = 0; for (var i=0; i<teamName.length; i++) hash = teamName.charCodeAt(i)+((hash<<5)-hash);
  var color = colors[Math.abs(hash) % colors.length];
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="55" fill="'+color+'" stroke="rgba(255,255,255,0.2)" stroke-width="4"/><text x="50%" y="55%" text-anchor="middle" fill="#fff" font-size="36" font-weight="bold" font-family="Arial" dy=".3em">'+initials+'</text></svg>';
  try { return 'data:image/svg+xml;base64,' + btoa(svg); } catch(e) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }
}

function parseMatchLine(line) {
  var tmp = line.trim().replace(/\r/g,'');
  if (!/\bv\.?s\.?\b/i.test(tmp)) return null;
  var date='', time='', score1='', score2='';
  var sm = tmp.match(/\b(\d{1,2})\s*[:\-\u2013\u2014]\s*(\d{1,2})\s*$/);
  if (sm) { score1=sm[1]; score2=sm[2]; tmp=tmp.substring(0,sm.index).trim(); }
  var dtm = tmp.match(/^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)(?:\s+(\d{1,2}[:.](\d{2}))(?:\s+(WIB|WITA|WIT))?)?/i);
  if (dtm) {
    date = dtm[1].replace('-','/');
    if (dtm[2]) { time = dtm[2].replace('.',':'); if (dtm[4]) time += ' ' + dtm[4].toUpperCase(); }
    tmp = tmp.substring(dtm[0].length).trim();
  } else {
    var tm = tmp.match(/^(\d{1,2}[:.](\d{2}))(?:\s+(WIB|WITA|WIT))?/i);
    if (tm) { time = tm[1].replace('.',':'); if (tm[3]) time += ' ' + tm[3].toUpperCase(); tmp = tmp.substring(tm[0].length).trim(); }
  }
  var vm = tmp.match(/^(.+?)\s+v\.?s\.?\s+(.+)$/i);
  if (!vm) return null;
  var team1 = vm[1].trim().replace(/\[\s*[nN]\s*\]/g,'').replace(/\s+/g,' ').trim();
  var team2 = vm[2].trim().replace(/\[\s*[nN]\s*\]/g,'').replace(/\s+/g,' ').trim();
  if (!team1 || !team2) return null;
  if (score1 === '') { score1 = '-'; score2 = '-'; }
  return { date: date||'-', time: time||'-', team1: team1, team2: team2, team1Clean: cleanName(team1), team2Clean: cleanName(team2), score1: score1, score2: score2 };
}

function parseAll(input) {
  var lines = input.split('\n').filter(function(l){ return l.trim() !== ''; });
  var result=[], curLeague=null, matches=[];
  for (var i=0; i<lines.length; i++) {
    var line = lines[i].trim();
    var m = parseMatchLine(line);
    if (!m) {
      if (curLeague && matches.length) result.push({name:curLeague, matches:matches.slice()});
      curLeague = line; matches = [];
    } else {
      if (curLeague) matches.push(m);
    }
  }
  if (curLeague && matches.length) result.push({name:curLeague, matches:matches.slice()});
  return result;
}

function autoPred(m) {
  var s1 = parseInt(m.score1)||0, s2 = parseInt(m.score2)||0;
  var hasScore = (m.score1 !== '-' && m.score2 !== '-');
  var total = s1 + s2, diff = Math.abs(s1 - s2);
  var homeWin = s1 > s2, awayWin = s2 > s1;
  var hcp, hcpClass, hcpNote;
  if (!hasScore) { hcp = m.team1+' -0.5'; hcpClass = 'green'; hcpNote = 'Prediksi Awal'; }
  else if (s1 === s2) { hcp = 'Draw / AH 0'; hcpClass = ''; hcpNote = 'Imbang ketat'; }
  else if (homeWin) { hcp = diff >= 2 ? m.team1+' -'+(diff-1)+'.5' : m.team1+' -0.5'; hcpClass = 'green'; hcpNote = 'Home unggul'; }
  else { hcp = diff >= 2 ? m.team2+' -'+(diff-1)+'.5' : m.team2+' -0.5'; hcpClass = 'green'; hcpNote = 'Away unggul'; }
  var ouLine = total <= 2 ? '2.5' : (total <= 4 ? '3.5' : '4.5');
  var _ouSeed = (m.team1 + m.team2).split('').reduce(function(a,c){ return a + c.charCodeAt(0); }, 0);
  var ouSide = _ouSeed % 2 === 0 ? 'Over' : 'Under';
  var ouPick = ouSide + ' ' + ouLine;
  var ouClass = ouSide === 'Over' ? 'green' : 'red';
  var _ouNotes = {'Over 2.5':'Laga Terbuka','Over 3.5':'Kedua Tim Menyerang','Over 4.5':'Banyak Gol','Under 2.5':'Laga Ketat','Under 3.5':'Pertahanan Solid','Under 4.5':'Tempo Rendah'};
  var ouNote = _ouNotes[ouPick] || 'Analisis AI';
  var ox2, ox2Class, ox2Note;
  if (homeWin) { ox2='Home Win'; ox2Class='green'; ox2Note=m.team1; }
  else if (awayWin) { ox2='Away Win'; ox2Class='green'; ox2Note=m.team2; }
  else { ox2='Draw'; ox2Class=''; ox2Note='Hasil imbang'; }
  return {hcp:hcp, hcpClass:hcpClass, hcpNote:hcpNote, ou:ouPick, ouClass:ouClass, ouNote:ouNote, ox2:ox2, ox2Class:ox2Class, ox2Note:ox2Note, acc:m.score1+' - '+m.score2};
}

function hexRgba(h,a){
  var r=parseInt(h.substring(1,3),16),g=parseInt(h.substring(3,5),16),b=parseInt(h.substring(5,7),16);
  return 'rgba('+r+','+g+','+b+','+a+')';
}


function buildOutputHTML() {
  var cfg = getSiteConfig();
  var g = cfg.cssVars['--g'];
  var gl = g, g2 = g, gd = hexRgba(g,0.4), gs = hexRgba(g,0.15);
  var totalM = leaguesData.reduce(function(a,l){ return a+l.matches.length; }, 0);
  var totalL = leaguesData.length;
  var autoDate = document.getElementById('gb-date') ? document.getElementById('gb-date').textContent : new Date().toLocaleDateString('id-ID', {day:'numeric',month:'long',year:'numeric'});

  var blockHtml = '';
  leaguesData.forEach(function(league){
    var enc = league.name.replace(/"/g,'&quot;');
    var mc = league.matches.length;
    blockHtml += '<div class="lb" data-league="'+enc+'"><div class="li">';
    blockHtml += '<div class="lc"><div class="lcn">🏆 '+league.name+'</div><div class="lcm">'+mc+' Match</div></div>';
    league.matches.forEach(function(m, mi){
      var l1 = getLogoUrl(m.team1Clean, league.name), l2 = getLogoUrl(m.team2Clean, league.name);
      var p = autoPred(m);
      var teamKey = (m.team1+' '+m.team2).toLowerCase();
      var cls = mi%2===0 ? 'ev' : 'od';
      var hAc = p.hcpClass==='green'?'ag':(p.hcpClass==='red'?'ar':'au');
      var oAc = p.ouClass==='green'?'ag':'ar';
      var xAc = p.ox2Class==='green'?'ag':'au';

      blockHtml += '<div class="mc '+cls+'" data-t="'+teamKey+'" onclick="this.classList.toggle(\'op\')">';
      blockHtml += '<div class="mr">';
      var fb1 = makeSVG(m.team1Clean), fb2 = makeSVG(m.team2Clean);
      blockHtml += '<div class="ts"><div class="bi"><img class="tl" src="'+l1+'" alt="'+m.team1+'" data-fallback="'+fb1+'"></div><span class="tn">'+m.team1+'</span></div>';
      blockHtml += '<div class="sc"><div class="sn">'+m.score1+' : '+m.score2+'</div><div class="md">'+m.date+' • '+m.time+'</div></div>';
      blockHtml += '<div class="ts tr"><div class="bi"><img class="tl" src="'+l2+'" alt="'+m.team2+'" data-fallback="'+fb2+'"></div><span class="tn">'+m.team2+'</span></div>';
      blockHtml += '<div class="ch">▶</div></div>';
      blockHtml += '<div class="pp"><div class="pg">';
      blockHtml += '<div class="pc '+hAc+'"><span class="pt">Handicap</span><span class="pv '+(p.hcpClass||'')+'">'+p.hcp+'</span><span class="pn">'+p.hcpNote+'</span></div>';
      blockHtml += '<div class="pc '+oAc+'"><span class="pt">Over/Under</span><span class="pv '+(p.ouClass||'')+'">'+p.ou+'</span><span class="pn">'+p.ouNote+'</span></div>';
      blockHtml += '<div class="pc '+xAc+'"><span class="pt">1X2</span><span class="pv '+(p.ox2Class||'')+'">'+p.ox2+'</span><span class="pn">'+p.ox2Note+'</span></div>';
      blockHtml += '<div class="pc au"><span class="pt">Skor Akurat</span><span class="pv">'+p.acc+'</span><span class="pn">Top Pick</span></div>';
      blockHtml += '</div></div></div>';
    });
    blockHtml += '</div></div>';
  });

  var leagueOpts = leaguesData.map(function(l){
    return '<option value="'+l.name.replace(/"/g,'&quot;')+'">🏆 '+l.name+'</option>';
  }).join('\n');

  return '<style>'
    +'*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}'
    +'body{background:#060b14;font-family:Poppins,sans-serif;color:#e2e8f0;min-height:100vh;overflow-x:hidden;}'
    +'.hero{background:linear-gradient(135deg,#0a0e17,#0f1a12,#0a0e17);border-bottom:1px solid rgba(16,185,129,0.12);text-align:center;padding:28px 20px 22px;position:relative;overflow:hidden;}'
    +'.hero::before{content:"";position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle at 30% 30%,rgba(16,185,129,0.05) 0%,transparent 50%),radial-gradient(circle at 70% 70%,rgba(245,158,11,0.03) 0%,transparent 50%);}'
    +'.ht{font-family:Cinzel,serif;font-size:clamp(22px,4vw,36px);font-weight:900;letter-spacing:4px;text-transform:uppercase;position:relative;background:linear-gradient(135deg,#10B981 0%,#34D399 30%,#F59E0B 70%,#FBBF24 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}'
    +'.hs{font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:5px;text-transform:uppercase;margin-top:4px;position:relative;}'
    +'.lo{display:flex;align-items:center;justify-content:center;margin:16px auto 0;width:90%;max-width:500px;padding:10px;background:rgba(0,0,0,0.2);border:1px solid '+gs+';border-radius:12px;}'
    +'.loi{height:56px;object-fit:contain;border-radius:6px;}'
    +'.dd{display:flex;align-items:center;justify-content:center;margin:14px auto;width:90%;max-width:500px;padding:10px 14px;border:1.5px solid '+g+'44;border-radius:12px;background:rgba(0,0,0,0.3);}'
    +'.dd span{font-family:Cinzel,serif;font-size:clamp(12px,2.5vw,15px);font-weight:700;color:'+g+';letter-spacing:2px;}'
    +'.sb{width:90%;max-width:500px;margin:0 auto 14px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}'
    +'.si{background:linear-gradient(180deg,rgba(16,185,129,0.08),rgba(16,185,129,0.02));border:1px solid '+gs+';border-radius:10px;padding:10px 8px;text-align:center;}'
    +'.sn2{font-family:Cinzel,serif;font-size:22px;font-weight:900;color:'+g+';line-height:1;text-shadow:0 0 16px '+gd+';}'
    +'.sl{font-size:9px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1.2px;font-weight:700;margin-top:3px;}'
    +'.mw{overflow:hidden;white-space:nowrap;width:90%;max-width:500px;margin:0 auto 14px;border:1.5px solid '+gs+';border-radius:12px;background:rgba(0,0,0,0.3);padding:12px 0;}'
    +'.mi{display:inline-block;animation:mr 40s linear infinite;padding-left:100%;font-size:clamp(10px,2vw,12px);font-weight:700;color:'+g+';letter-spacing:1.5px;}'
    +'@keyframes mr{0%{transform:translateX(0)}100%{transform:translateX(-100%)}}'
    +'.fw{width:90%;max-width:500px;margin:0 auto 14px;display:grid;grid-template-columns:1fr 1fr;gap:8px;}'
    +'.fl{font-size:9px;color:'+g+';opacity:.7;text-transform:uppercase;letter-spacing:1.2px;font-weight:700;margin-bottom:4px;display:block;}'
    +'.fs{width:100%;padding:7px 10px;background:rgba(0,0,0,0.5);border:1.5px solid '+gs+';border-radius:8px;color:'+g+';font-size:11px;font-weight:600;appearance:none;outline:none;cursor:pointer;}'
    +'.fs option{background:#0a0e17;color:#fff;}'
    +'.fis{width:100%;padding:7px 10px;background:rgba(0,0,0,0.5);border:1.5px solid '+gs+';border-radius:8px;color:'+g+';font-size:11px;font-weight:600;outline:none;}'
    +'.fis::placeholder{color:rgba(255,255,255,0.2);}'
    +'.th{width:90%;max-width:500px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 14px;border:1.5px solid '+gs+';border-radius:10px;background:rgba(16,185,129,0.04);}'
    +'.tha{font-size:13px;display:inline-block;animation:ab 1s ease-in-out infinite;}'
    +'@keyframes ab{0%,100%{transform:translateY(0)}50%{transform:translateY(4px)}}'
    +'.tht{font-family:Cinzel,serif;font-size:9px;font-weight:700;color:'+g+';letter-spacing:1px;}'
    +'.lb{width:90%;max-width:500px;margin:0 auto 16px;border:1px solid '+gs+';border-radius:12px;overflow:hidden;background:linear-gradient(180deg,rgba(16,185,129,0.03),transparent);box-shadow:0 2px 16px rgba(0,0,0,0.15);}'
    +'.li{border-radius:10px;overflow:hidden;}'
    +'.lc{background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(16,185,129,0.02));padding:10px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid '+gs+';position:relative;overflow:hidden;}'
    +'.lc::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,'+g+',transparent);}'
    +'.lcn{font-family:Cinzel,serif;font-size:clamp(10px,1.8vw,12px);font-weight:900;color:'+g+';letter-spacing:1.5px;text-transform:uppercase;}'
    +'.lcm{background:'+g+';color:#000;font-family:Cinzel,serif;font-size:9px;font-weight:900;padding:3px 10px;border-radius:20px;white-space:nowrap;}'
    +'.mc{cursor:pointer;user-select:none;transition:background .2s;border-bottom:1px solid rgba(255,255,255,0.03);}'
    +'.mc:last-child{border-bottom:none;}'
    +'.mc.ev{background:rgba(255,255,255,0.02);}'
    +'.mc:hover{background:rgba(16,185,129,0.04)!important;}'
    +'.mr{display:flex;align-items:center;padding:10px 14px;}'
    +'.ts{flex:1;display:flex;align-items:center;gap:8px;min-width:0;}'
    +'.tr{flex-direction:row-reverse;}'
    +'.bi{position:relative;width:52px;height:52px;flex-shrink:0;}'
    +'.tl{width:52px;height:52px;object-fit:contain;filter:drop-shadow(0 0 8px rgba(16,185,129,0.15));transition:transform .3s,filter .3s;border-radius:6px;}'
    +'.mc:hover .tl{transform:scale(1.12);filter:drop-shadow(0 0 10px rgba(16,185,129,0.3))brightness(1.1)!important;}'
    +'.tn{font-weight:600;color:#e2e8f0;font-size:clamp(11px,1.5vw,13px);line-height:1.3;word-break:break-word;}'
    +'.tr .tn{text-align:right;}'
    +'.sc{flex-shrink:0;text-align:center;margin:0 12px;}'
    +'.sn{font-family:Cinzel,serif;font-size:clamp(16px,3vw,20px);font-weight:900;color:'+g+';text-shadow:0 0 12px '+gd+';letter-spacing:2px;line-height:1;}'
    +'.md{font-size:9px;color:rgba(255,255,255,0.3);margin-top:2px;}'
    +'.ch{width:20px;flex-shrink:0;text-align:center;color:'+g+';font-size:10px;opacity:.4;transition:transform .3s;}'
    +'.mc.op .ch{transform:rotate(90deg);opacity:.8;}'
    +'.pp{overflow:hidden;max-height:0;transition:max-height .35s ease;}'
    +'.mc.op .pp{max-height:200px;}'
    +'.pg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:10px 14px;background:rgba(0,0,0,0.3);border-top:1px solid '+gs+';}'
    +'@media(max-width:440px){.pg{grid-template-columns:repeat(2,1fr);}}'
    +'.pc{background:rgba(16,185,129,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px 6px;text-align:center;position:relative;overflow:hidden;}'
    +'.pc::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;}'
    +'.pc.ag::before{background:linear-gradient(90deg,transparent,'+g+',transparent);}'
    +'.pc.ar::before{background:linear-gradient(90deg,transparent,#EF4444,transparent);}'
    +'.pc.au::before{background:linear-gradient(90deg,transparent,#F59E0B,transparent);}'
    +'.pt{font-family:Cinzel,serif;font-size:8px;font-weight:700;color:'+g+';letter-spacing:1px;text-transform:uppercase;display:block;margin-bottom:4px;opacity:.7;}'
    +'.pv{font-weight:700;font-size:clamp(11px,2vw,14px);display:block;line-height:1.3;color:'+gl+';}'
    +'.pv.green{color:#34D399;}.pv.red{color:#F87171;}'
    +'.pn{font-size:8px;color:rgba(255,255,255,0.35);display:block;margin-top:2px;}'
    +'.ft{text-align:center;padding:20px;color:rgba(255,255,255,0.15);font-size:10px;letter-spacing:1px;}'
    +'</style>\n'
    +'<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">\n\n'
    +'<div class="hero"><div class="ht">⚽ Prediksi Bola</div><div class="hs">Analisis &amp; Prediksi Pertandingan</div></div>\n\n'
    +'<div class="lo"><img class="loi" src="'+cfg.logo+'" alt="'+cfg.name+'"></div>\n\n'
    +'<div class="dd"><span>📅 '+autoDate+'</span></div>\n\n'
    +'<div class="sb"><div class="si"><div class="sn2">'+totalL+'</div><div class="sl">Liga</div></div><div class="si"><div class="sn2">'+totalM+'</div><div class="sl">Pertandingan</div></div><div class="si"><div class="sn2">100%</div><div class="sl">Terupdate</div></div></div>\n\n'
    +'<div class="mw"><div class="mi">🔥 PREDIKSI BOLA TERUPDATE ! Daftar di '+cfg.name+' dan nikmati pengalaman taruhan terbaik! 🔥</div></div>\n\n'
    +'<div class="fw"><div><div class="fl">🏆 Pilih Liga</div><select class="fs" id="lf" onchange="fl(this.value)"><option value="all">Semua Liga</option>'+leagueOpts+'</select></div>'
    +'<div><div class="fl">🔍 Cari Tim</div><input class="fis" id="ts" type="text" placeholder="Nama tim..." oninput="st(this.value)"></div></div>\n\n'
    +'<div class="th"><span class="tha">⬇</span><span class="tht">Klik pertandingan untuk melihat prediksi</span><span class="tha">⬇</span></div>\n\n'
    +blockHtml
    +'<div class="ft">© Prediksi Bola • All Rights Reserved</div>\n'
    +'<script>\n'
    +'function fl(v){document.getElementById("ts").value="";document.querySelectorAll(".mc").forEach(function(c){c.classList.remove("hd");});document.querySelectorAll(".lb").forEach(function(b){b.style.display=(v==="all"||b.dataset.league===v)?"":"none";});}\n'
    +'function st(v){document.getElementById("lf").value="all";document.querySelectorAll(".lb").forEach(function(b){b.style.display="";});var q=v.trim().toLowerCase();document.querySelectorAll(".mc").forEach(function(c){if(!q){c.classList.remove("hd");return;}c.classList.toggle("hd",(c.dataset.t||"").indexOf(q)===-1);});document.querySelectorAll(".lb").forEach(function(b){b.style.display=b.querySelectorAll(".mc:not(.hd)").length?"":"none";});}\n'
    +'document.querySelectorAll(".tl").forEach(function(i){i.onerror=function(){if(this.src!==this.dataset.fallback)this.src=this.dataset.fallback;};if(i.complete&&i.naturalWidth===0)i.src=i.dataset.fallback;});\n'
    +'<\/script>\n';
}

var debounceTimer = null;

function getPreviewFrame() {
  var container = document.getElementById('gb-preview');
  if (!container) return null;
  var frame = container.querySelector('.gb-preview-frame');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.className = 'gb-preview-frame';
    frame.style.cssText = 'width:100%;border:none;border-radius:10px;background:#060b14;display:block;';
    container.innerHTML = '';
    container.appendChild(frame);
  }
  return frame;
}

function setPreviewHTML(html) {
  var frame = getPreviewFrame();
  if (!frame) return;
  frame.srcdoc = html;
  frame.onload = function(){
    try {
      var h = frame.contentDocument.documentElement.scrollHeight;
      frame.style.height = h + 'px';
    } catch(e){}
  };
}

function handleInput() {
  var input = document.getElementById('gb-input');
  var preview = document.getElementById('gb-preview');
  var output = document.getElementById('gb-output');
  var leaguesStat = document.getElementById('gb-leagues-stat');
  var matchesStat = document.getElementById('gb-matches-stat');
  var logosStat = document.getElementById('gb-logos-stat');
  var notif = document.getElementById('gb-notif');
  if (!input || !preview || !output) return;

  var text = input.value.trim();
  if (!text) {
    preview.innerHTML = '<div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.2);font-family:Cinzel,serif;font-size:13px;letter-spacing:1px;">Preview akan muncul di sini secara otomatis...</div>';
    output.textContent = 'Script HTML akan muncul di sini...';
    if (leaguesStat) leaguesStat.textContent = '0';
    if (matchesStat) matchesStat.textContent = '0';
    if (logosStat) logosStat.textContent = '0';
    leaguesData = [];
    return;
  }

  leaguesData = parseAll(text);
  if (!leaguesData.length) return;

  if (leaguesStat) leaguesStat.textContent = leaguesData.length;
  if (matchesStat) matchesStat.textContent = leaguesData.reduce(function(a,l){ return a+l.matches.length; }, 0);

  var outHtml = buildOutputHTML();
  output.textContent = outHtml;
  setPreviewHTML(outHtml);

  var allCleans = [];
  leaguesData.forEach(function(l){ l.matches.forEach(function(m){ allCleans.push(m.team1Clean); allCleans.push(m.team2Clean); }); });
  function refreshPreview() {
    var matched = 0;
    allCleans.forEach(function(name){
      var url = getLogoUrl(name);
      if (url && url.indexOf('data:image/svg') !== 0) { matched++; }
    });
    if (logosStat) logosStat.textContent = matched;
    var refreshedHtml = buildOutputHTML();
    output.textContent = refreshedHtml;
    setPreviewHTML(refreshedHtml);
  }
  fetchLogoBatch(allCleans, refreshPreview).then(refreshPreview);

  if (notif) {
    notif.textContent = '✅ ' + leaguesData.length + ' liga, ' + leaguesData.reduce(function(a,l){ return a+l.matches.length; }, 0) + ' pertandingan';
    notif.style.display = 'block';
    setTimeout(function(){ notif.style.opacity = '0'; }, 3000);
  }
}

function copyOutput() {
  var output = document.getElementById('gb-output');
  var btn = document.getElementById('gb-copy-btn');
  if (!output || !btn) return;
  var text = output.textContent;
  if (!text || text.indexOf('Script HTML') === 0) {
    btn.textContent = '⚠️ Kosong'; setTimeout(function(){ btn.innerHTML = '📋 Copy Script'; }, 1500);
    return;
  }
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) { btn.innerHTML = '✅ Tersalin!'; setTimeout(function(){ btn.innerHTML = '📋 Copy Script'; }, 2000); return; }
  } catch(e) {}
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function(){
      btn.innerHTML = '✅ Tersalin!'; setTimeout(function(){ btn.innerHTML = '📋 Copy Script'; }, 2000);
    });
  }
}

function clearInput() {
  var input = document.getElementById('gb-input');
  var preview = document.getElementById('gb-preview');
  var output = document.getElementById('gb-output');
  if (input) input.value = '';
  if (preview) preview.innerHTML = '<div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.2);font-family:Cinzel,serif;font-size:13px;letter-spacing:1px;">Preview akan muncul di sini secara otomatis...</div>';
  if (output) output.textContent = 'Script HTML akan muncul di sini...';
  leaguesData = [];
  ['gb-leagues-stat','gb-matches-stat','gb-logos-stat'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.textContent = '0';
  });
}

function populateConfig() {
  var cfg = loadConfig();
  var nameEl = document.getElementById('gb-cfg-name');
  var logoEl = document.getElementById('gb-cfg-logo');
  var colorEl = document.getElementById('gb-cfg-color');
  var colorPicker = document.getElementById('gb-cfg-color-picker');
  var logoPreview = document.getElementById('gb-cfg-logo-preview');
  if (nameEl) nameEl.value = cfg.name;
  if (logoEl) logoEl.value = cfg.logo;
  if (colorEl) colorEl.value = cfg.color;
  if (colorPicker) colorPicker.value = cfg.color;
  if (logoPreview && cfg.logo) {
    logoPreview.src = cfg.logo;
    logoPreview.style.display = 'block';
  }
}

function initGeneratorBola() {
  var input = document.getElementById('gb-input');
  var pane = document.getElementById('pane-generator-bola');
  if (!input || !pane) return;

  initGithubLogoMap().then(function(){
    if (leaguesData.length) handleInput();
  });

  input.addEventListener('input', function(){
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(handleInput, 500);
  });

  var copyBtn = document.getElementById('gb-copy-btn');
  if (copyBtn) copyBtn.addEventListener('click', copyOutput);

  var clearBtn = document.getElementById('gb-clear-btn');
  if (clearBtn) clearBtn.addEventListener('click', clearInput);

  var dateEl = document.getElementById('gb-date');
  if (dateEl) {
    var today = new Date();
    var tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    var d1 = today.toLocaleDateString('id-ID', {day:'numeric',month:'long'});
    var d2 = tomorrow.toLocaleDateString('id-ID', {day:'numeric',month:'long',year:'numeric'});
    dateEl.textContent = d1 + ' - ' + d2;
  }

  populateConfig();

  var toggle = document.getElementById('gb-config-toggle');
  var panel = document.getElementById('gb-config-panel');
  if (toggle && panel) {
    toggle.addEventListener('click', function(){
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') populateConfig();
    });
  }

  var logoInput = document.getElementById('gb-cfg-logo');
  var logoPreview = document.getElementById('gb-cfg-logo-preview');
  if (logoInput && logoPreview) {
    logoInput.addEventListener('input', function(){
      logoPreview.src = logoInput.value || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      logoPreview.style.display = logoInput.value ? 'block' : 'none';
    });
  }

  var colorInput = document.getElementById('gb-cfg-color');
  var colorPicker = document.getElementById('gb-cfg-color-picker');
  if (colorInput && colorPicker) {
    colorInput.addEventListener('input', function(){
      if (/^#[0-9a-f]{6}$/i.test(colorInput.value)) colorPicker.value = colorInput.value;
    });
    colorPicker.addEventListener('input', function(){
      colorInput.value = colorPicker.value;
    });
  }

  function applyConfig() {
    var cfg = {
      name: (document.getElementById('gb-cfg-name') || {}).value || getDefaultConfig().name,
      logo: (document.getElementById('gb-cfg-logo') || {}).value || getDefaultConfig().logo,
      color: (document.getElementById('gb-cfg-color') || {}).value || getDefaultConfig().color
    };
    saveConfig(cfg);
    handleInput();
  }

  var saveBtn = document.getElementById('gb-cfg-save');
  if (saveBtn) saveBtn.addEventListener('click', applyConfig);

  var resetBtn = document.getElementById('gb-cfg-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', function(){
      var def = getDefaultConfig();
      var nameEl = document.getElementById('gb-cfg-name');
      var logoEl = document.getElementById('gb-cfg-logo');
      var colorEl = document.getElementById('gb-cfg-color');
      if (nameEl) nameEl.value = def.name;
      if (logoEl) logoEl.value = def.logo;
      if (colorEl) colorEl.value = def.color;
      if (colorPicker) colorPicker.value = def.color;
      if (logoPreview) { logoPreview.src = def.logo; logoPreview.style.display = 'block'; }
      saveConfig(def);
      handleInput();
    });
  }

}
window.initGeneratorBola = initGeneratorBola;
