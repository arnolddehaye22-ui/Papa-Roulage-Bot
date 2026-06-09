const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
const Fuse = require('fuse.js');
const { Hono } = require('hono');
const { serve } = require('@hono/node-server');

console.log("=== 🚗 PAPA ROULAGE V4.3 (CARTE COMPLÈTE) ===");

// Forçage du fuseau horaire
process.env.TZ = 'Africa/Kinshasa';

// ==========================================
// 0. CACHE STATS
// ==========================================
let statsCache = null;
let lastStatsUpdate = 0;
const STATS_CACHE_TTL = 15 * 60 * 1000;

// ==========================================
// 1. CONNEXION POSTGRESQL
// ==========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('⚠️ Erreur PostgreSQL :', err.message);
});

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS signalements (
        id SERIAL PRIMARY KEY,
        rue TEXT NOT NULL,
        etat TEXT NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        jour TEXT,
        heure INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_signalements_rue_timestamp ON signalements (rue, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_signalements_stats ON signalements (jour, heure);
      CREATE INDEX IF NOT EXISTS idx_signalements_timestamp ON signalements (timestamp);
    `);
    console.log("📊 Base PostgreSQL initialisée.");
  } catch (err) {
    console.error("⚠️ Erreur BDD :", err.message);
  }
})();

// ==========================================
// 2. DICTIONNAIRE DES RUES (65 AXES)
// ==========================================
const rues = [
  { nom: "Boulevard du 30 Juin", lat: -4.3225, lon: 15.3112, alias: ["30 juin", "bd du 30", "trente juin", "bld 30", "grand boulevard", "socimat", "gare centrale", "royal", "batetela", "kitambo magasin", "gombé", "gombe"] },
  { nom: "Avenue Kasa-Vubu", lat: -4.3281, lon: 15.3156, alias: ["kasa vubu", "kasa", "av kasa", "kasavubu", "rond-point victoire", "victoire", "central", "bandal", "mariage"] },
  { nom: "Boulevard Triomphal", lat: -4.3356, lon: 15.3050, alias: ["triomphal", "bd triomphal", "triomphale", "palais du peuple", "stade des martyrs", "martyrs"] },
  { nom: "Rond-point Ngaba", lat: -4.3844, lon: 15.3475, alias: ["ngaba", "rp ngaba", "rond point ngaba", "triangle", "universite", "université"] },
  { nom: "Avenue de la Libération", lat: -4.3500, lon: 15.2800, alias: ["liberation", "ex 24 novembre", "24 novembre", "24 nov", "bandal", "moulaert", "selembao"] },
  { nom: "Route de Matadi", lat: -4.3650, lon: 15.2300, alias: ["route matadi", "matadi", "binza", "delvaux", "upn", "barriere", "pompage", "lalou"] },
  { nom: "Boulevard Lumumba", lat: -4.3400, lon: 15.3500, alias: ["lumumba", "bd lumumba", "route de l'aeroport", "ndjili", "pascal", "kingasani", "limete", "echangeur", "échangeur", "quartier 1", "q1", "masina"] },
  { nom: "Avenue Bypass", lat: -4.3750, lon: 15.3550, alias: ["bypass", "by-pass", "by pass", "cite verte", "cité verte", "rimeo"] },
  { nom: "Avenue de l'Université", lat: -4.3900, lon: 15.3400, alias: ["universite", "université", "livulu", "intendance", "unikin", "yolo", "kapela"] },
  { nom: "Boulevard Congo Japon (Poids Lourds)", lat: -4.3100, lon: 15.3000, alias: ["poids lourds", "poids lourd", "congo japon", "congo-japon", "gare centrale", "baramoto", "kingabwa"] },
  { nom: "Avenue du Tourisme (Route de Kinsuka)", lat: -4.3400, lon: 15.2000, alias: ["tourisme", "av du tourisme", "kinsuka", "pompage", "mimosa", "fleuve"] },
  { nom: "Avenue Kimwenza", lat: -4.3950, lon: 15.3450, alias: ["kimwenza", "yolo", "av kimwenza", "kapela", "kala"] },
  { nom: "Avenue du Commerce", lat: -4.3200, lon: 15.3080, alias: ["commerce", "av commerce", "grande poste", "kin marche", "kinmarché", "poste"] },
  { nom: "Avenue de la Justice", lat: -4.3250, lon: 15.3120, alias: ["justice", "palais de justice", "cour", "av justice"] },
  { nom: "Avenue des Huileries", lat: -4.3300, lon: 15.3180, alias: ["huileries", "huilco", "sodeico", "av huileries", "huile"] },
  { nom: "Avenue Wangata", lat: -4.3350, lon: 15.3220, alias: ["wangata", "funa", "stade", "av wangata", "wangata funa"] },
  { nom: "Avenue Flambeau", lat: -4.3380, lon: 15.3250, alias: ["flambeau", "clair", "lumière", "av flambeau"] },
  { nom: "Rond-point Forescom", lat: -4.3320, lon: 15.3160, alias: ["forescom", "forecom", "rp forescom"] },
  { nom: "Avenue de l'École", lat: -4.3420, lon: 15.3280, alias: ["ecole", "école", "av ecole", "lycee", "lycée"] },
  { nom: "Avenue du Port", lat: -4.3150, lon: 15.3050, alias: ["port", "av port", "beach", "ngobila", "beach ngobila"] },
  { nom: "Croisement Diplomate", lat: -4.3220, lon: 15.3130, alias: ["diplomate", "croisement diplomate", "carrefour diplomate", "rond-point diplomate"] },
  { nom: "Safricas", lat: -4.3420, lon: 15.3540, alias: ["safricas", "depot safricas", "safricas masina", "carrefour safricas"] },
  { nom: "Asanef", lat: -4.3380, lon: 15.3480, alias: ["asanef", "croisement asanef", "carrefour asanef", "asanef lumumba"] },
  { nom: "Carrefour Ngaliema", lat: -4.3500, lon: 15.2750, alias: ["carrefour ngaliema", "ngaliema carrefour", "croisement ngaliema", "rond point magasin", "rp magasin", "magasin"] },
  { nom: "Carrefour Camp Luka", lat: -4.3580, lon: 15.2600, alias: ["camp luka", "carrefour camp luka", "luka"] },
  { nom: "Avenue ISTM", lat: -4.3300, lon: 15.3180, alias: ["istm", "av istm", "institut istm"] },
  { nom: "Petro Congo", lat: -4.3225, lon: 15.3115, alias: ["petro", "petro congo", "petro righini", "station petro"] },
  { nom: "Carrefour Kingabwa", lat: -4.3100, lon: 15.2980, alias: ["kingabwa", "carrefour kingabwa", "croisement kingabwa"] },
  { nom: "Avenue Sendwe", lat: -4.3180, lon: 15.3020, alias: ["sendwe", "av sendwe", "sendwe port"] },
  { nom: "Carrefour Zando", lat: -4.3260, lon: 15.3160, alias: ["zando", "carrefour zando", "zando kasa vubu"] },
  { nom: "Rond-point Victoire", lat: -4.3280, lon: 15.3160, alias: ["victoire", "rp victoire", "rond point victoire", "victoire kasa vubu"] },
  { nom: "Rond-point UPN", lat: -4.3650, lon: 15.2350, alias: ["upn", "rp upn", "rond point upn", "upn matadi"] },
  { nom: "Rond-point Camp Kokolo", lat: -4.3500, lon: 15.2750, alias: ["camp kokolo", "rp kokolo", "kokolo", "camp"] },
  { nom: "Rond-point Société", lat: -4.3220, lon: 15.3120, alias: ["société", "rp société", "societe", "rp societe"] },
  { nom: "Marché Central", lat: -4.3180, lon: 15.3100, alias: ["marché central", "grand marché", "central"] },
  { nom: "Marché de la Liberté", lat: -4.3550, lon: 15.2900, alias: ["marché liberté", "liberté", "marché gambela", "gambela"] },
  { nom: "Marché Gambela", lat: -4.3600, lon: 15.2850, alias: ["gambela", "marche gambela"] },
  { nom: "Marché de Matonge", lat: -4.3280, lon: 15.3180, alias: ["matonge", "marché matonge"] },
  { nom: "Marché de Ndjili", lat: -4.3450, lon: 15.3550, alias: ["marché ndjili", "ndjili marché"] },
  { nom: "Clinique Ngaliema", lat: -4.3520, lon: 15.2700, alias: ["ngaliema", "clinique ngaliema", "hôpital ngaliema"] },
  { nom: "Hôpital du Cinquantenaire", lat: -4.3350, lon: 15.3080, alias: ["cinquantenaire", "hôpital 50 ans", "50 ans"] },
  { nom: "Hôpital de l'ONATRA", lat: -4.3220, lon: 15.3120, alias: ["onatra", "hôpital onatra"] },
  { nom: "Clinique Kinoise", lat: -4.3280, lon: 15.3150, alias: ["clinique kinoise", "kinoise"] },
  { nom: "INSS", lat: -4.3300, lon: 15.3100, alias: ["inss", "inss kasa vubu"] },
  { nom: "ISTA", lat: -4.3800, lon: 15.3450, alias: ["ista", "ista ngaba"] },
  { nom: "ISC", lat: -4.3350, lon: 15.3200, alias: ["isc", "isc kin"] },
  { nom: "Lycée Bosangani", lat: -4.3380, lon: 15.3220, alias: ["bosangani", "lycee bosangani"] },
  { nom: "Collège Boboto", lat: -4.3400, lon: 15.3250, alias: ["boboto", "college boboto"] },
  { nom: "Carrefour Lemba", lat: -4.3700, lon: 15.3350, alias: ["lemba", "carrefour lemba", "lemba marche"] },
  { nom: "Carrefour Mbanza Lemba", lat: -4.3750, lon: 15.3400, alias: ["mbanza lemba", "mbanza"] },
  { nom: "Carrefour Kingasani", lat: -4.3450, lon: 15.3480, alias: ["kingasani carrefour", "kingasani"] },
  { nom: "Carrefour Masina", lat: -4.3500, lon: 15.3600, alias: ["masina carrefour", "masina"] },
  { nom: "Rond-point Kintambo", lat: -4.3150, lon: 15.2950, alias: ["kintambo", "rp kintambo", "rond point kintambo"] },
  { nom: "Rond-point Kampeta", lat: -4.3220, lon: 15.3080, alias: ["kampeta", "rp kampeta"] },
  { nom: "Rond-point Righini", lat: -4.3350, lon: 15.3050, alias: ["righini", "rp righini"] },
  { nom: "Rond-point Mwana Mbuyi", lat: -4.3400, lon: 15.3100, alias: ["mwana mbuyi", "rp mwana mbuyi"] },
  { nom: "Rond-point Sozacom", lat: -4.3480, lon: 15.3150, alias: ["sozacom", "rp sozacom"] },
  { nom: "Stade des Martyrs", lat: -4.3350, lon: 15.3050, alias: ["martyrs", "stade martyrs", "stade"] },
  { nom: "Stade Tata Raphaël", lat: -4.3280, lon: 15.3120, alias: ["tata raphaël", "tata", "tata raphael"] },
  { nom: "Palais de la Nation", lat: -4.3250, lon: 15.3100, alias: ["palais nation", "palais"] },
  { nom: "Tour de l'Échangeur", lat: -4.3400, lon: 15.3500, alias: ["tour echangeur", "tour"] },
  { nom: "Gare de Limete", lat: -4.3420, lon: 15.3520, alias: ["gare limete", "limete gare"] },
  { nom: "Beach Ngobila", lat: -4.3150, lon: 15.3050, alias: ["beach", "ngobila"] },
  { nom: "Kinshasa Golf", lat: -4.3550, lon: 15.2800, alias: ["golf", "golf kinshasa"] }
];

// Configuration Fuse.js
const fuse = new Fuse(rues, {
  keys: [{ name: 'alias', weight: 3 }, { name: 'nom', weight: 1 }],
  threshold: 0.3,
  ignoreLocation: true
});

// ==========================================
// 3. MODULE DE COMPRÉHENSION DES INTENTIONS
// ==========================================
const intentions = {
  bouchon: {
    mots: ["bouchon", "embouteillage", "bloqué", "coincé", "bouché", "mort", "bordel"],
    phrases: [
      /c['']?est\s+(mort|bouché|bloqué|coincé|fini|fermé)/i,
      /(ya|il y a)\s+trop\s+de\s+(voitures|bagnoles|véhicules|gens)/i,
      /(on|ça)\s+(n['']?avance|avance\s+pas|ne\s+circule\s+pas|est\s+bloqué)/i,
      /(c['']?est|très|trop)\s+(chargé|saturé|dense|énorme)/i,
      /ca\s+(ne\s+)?bouge\s+pas/i,
      /c['']?est\s+le\s+bordel/i,
      /(bloqué|coincé|bouché)\s+total/i,
      /(ça|on)\s+(bouchonne|se\s+traîne)/i
    ],
    etat: "🔴 BOUCHON / BLOCAGE TOTAL"
  },
  accident: {
    mots: ["accident", "cogné", "choc", "tamponné", "carton", "percuté", "heurté"],
    phrases: [
      /(ya|il y a)\s+(eu\s+)?un\s+accident/i,
      /deux\s+(voitures|bagnoles|véhicules)\s+(se\s+sont\s+)?cognées/i,
      /(voitures|bagnoles|motards)\s+accidentées/i,
      /(choc|collision)\s+(frontal|arrière|latéral)/i,
      /(moto|voiture)\s+(renversé|renversée)/i
    ],
    etat: "⚠️ ACCIDENT SUR LA VOIE ⚠️"
  },
  fluide: {
    mots: ["fluide", "calme", "normal", "vide", "clair", "dégagé", "libre", "bonne"],
    phrases: [
      /(ça|la\s+circulation|la\s+route|le\s+trafic)\s+(roule|circule|coule)\s+(bien|normalement|correctement|tranquillement)/i,
      /c['']?est\s+(fluide|clair|dégagé|libre|bonne)/i,
      /(ya|il y a)\s+(rien|pas\s+de\s+problème|pas\s+de\s+bouchon)/i,
      /ca\s+roule\s+(bien|sans\s+problème|super|nickel)/i,
      /pas\s+(trop\s+)?(de\s+)?(monde|voitures|difficultés)/i,
      /(on|ça)\s+(circule|avance)\s+(bien|normal)/i
    ],
    etat: "🟢 FLUIDE / ÇA ROULE BIEN"
  },
  ralentissement: {
    mots: ["ralenti", "lent", "petit bouchon", "circule doucement", "coince"],
    phrases: [
      /(ça|on|le\s+trafic)\s+(coince|ralentit|avance\s+lentement|se\s+traîne)\b/i,
      /(petit|un\s+peu\s+de|mini)\s+(bouchon|ralenti|embouteillage)/i,
      /c['']?est\s+(ralenti|lent|chargé\s+sans\s+plus)/i,
      /(on|c['']?est)\s+(dans|dans\s+un)\s+(petit\s+)?(ralenti|bouchon)/i,
      /ça\s+(commence\s+à|un\s+peu)\s+(coincer|charger)/i,
      /(légèrement|un\s+peu)\s+(bloqué|bouché|ralenti)/i
    ],
    etat: "🟡 RALENTISSEMENT LÉGER"
  }
};

function comprendreIntention(texte) {
  const texteLower = texte.toLowerCase();
  for (const [intention, data] of Object.entries(intentions)) {
    for (const mot of data.mots) {
      if (texteLower.includes(mot)) {
        console.log(`[INTENTION] ${intention} détectée par mot-clé : "${mot}"`);
        return data.etat;
      }
    }
    for (const regex of data.phrases) {
      if (regex.test(texteLower)) {
        console.log(`[INTENTION] ${intention} détectée par regex`);
        return data.etat;
      }
    }
  }
  console.log(`[INTENTION] Aucune intention détectée`);
  return null;
}

function extraireLieu(texte) {
  const motsIntention = Object.values(intentions).flatMap(i => i.mots);
  let texteNettoye = texte;
  for (const mot of motsIntention) {
    texteNettoye = texteNettoye.replace(new RegExp(`\\b${mot}\\b`, 'gi'), '');
  }
  const motsParasites = ["sur", "à", "au", "aux", "dans", "vers", "pour", "avec", "de", "du", "des", "et", "le", "la", "les", "un", "une", "vers", "côté", "niveau", "proche", "près", "autour", "frère", "cher", "s'il", "vous", "plaît", "stp", "sil", "vousplait"];
  for (const mot of motsParasites) {
    texteNettoye = texteNettoye.replace(new RegExp(`\\b${mot}\\b`, 'gi'), '');
  }
  texteNettoye = texteNettoye.trim().replace(/\s+/g, ' ');
  console.log(`[EXTRACTION] Texte nettoyé : "${texteNettoye}"`);
  
  for (const axe of rues) {
    for (const alias of axe.alias) {
      if (texteNettoye.includes(alias)) {
        console.log(`[EXTRACTION] Lieu trouvé : ${axe.nom} via alias "${alias}"`);
        return axe;
      }
    }
  }
  const recherche = fuse.search(texteNettoye);
  if (recherche.length > 0) {
    console.log(`[EXTRACTION] Lieu trouvé via Fuse.js : ${recherche[0].item.nom}`);
    return recherche[0].item;
  }
  console.log(`[EXTRACTION] Aucun lieu trouvé`);
  return null;
}

// ==========================================
// 4. FONCTIONS BASE DE DONNÉES (sans lat/lon)
// ==========================================
async function sauvegarderSignalement(rue, etat) {
  const maintenant = new Date();
  const jour = maintenant.toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'Africa/Kinshasa' });
  const heure = parseInt(maintenant.toLocaleTimeString('fr-FR', { hour: '2-digit', hour12: false, timeZone: 'Africa/Kinshasa' }));
  try {
    await pool.query(
      'INSERT INTO signalements (rue, etat, jour, heure) VALUES ($1, $2, $3, $4)',
      [rue, etat, jour, heure]
    );
    statsCache = null;
    console.log(`💾 Signalement enregistré : ${rue} → ${etat} (${jour} - ${heure}h)`);
  } catch (err) {
    console.error("❌ Erreur sauvegarde :", err.message);
  }
}

async function getDernierSignalement(rue) {
  try {
    const result = await pool.query(
      'SELECT etat, timestamp FROM signalements WHERE rue = $1 ORDER BY timestamp DESC LIMIT 1',
      [rue]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (err) {
    console.error("❌ Erreur lecture :", err.message);
    return null;
  }
}

async function getStats() {
  try {
    const [topRues, heurePointe, jourPointe] = await Promise.all([
      pool.query(`SELECT rue, COUNT(*) as total FROM signalements GROUP BY rue ORDER BY total DESC LIMIT 5`),
      pool.query(`SELECT heure, COUNT(*) as total FROM signalements GROUP BY heure ORDER BY total DESC LIMIT 1`),
      pool.query(`SELECT jour, COUNT(*) as total FROM signalements GROUP BY jour ORDER BY total DESC LIMIT 1`)
    ]);
    return { topRues: topRues.rows, heurePointe: heurePointe.rows[0], jourPointe: jourPointe.rows[0] };
  } catch (err) {
    console.error("❌ Erreur stats :", err.message);
    return null;
  }
}

async function getStatsWithCache() {
  const now = Date.now();
  if (statsCache && (now - lastStatsUpdate) < STATS_CACHE_TTL) {
    console.log("📊 Stats depuis cache");
    return statsCache;
  }
  statsCache = await getStats();
  lastStatsUpdate = now;
  return statsCache;
}

// ==========================================
// 5. LE BOT TELEGRAM
// ==========================================
if (!process.env.BOT_TOKEN) {
  console.error("❌ ERREUR FATALE : BOT_TOKEN non défini !");
  process.exit(1);
}
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply(`🇨🇩 PAPA ROULAGE V4.3 - CARTE COMPLÈTE ! 🚗

📢 POUR SIGNALER (langage naturel) :
"C'est mort à Socimat"
"Ça roule bien sur le 30 Juin"
"Ya trop de voitures vers Ngaba"

🔍 CONSULTER : /etat Commerce
🗺️ CARTE : /carte (20 lignes + 45 points)
📊 STATS : /stats
📋 LISTE : /liste`);
});

bot.command('carte', (c) => c.reply(`🗺️ PAPA ROULAGE - CARTE INTERACTIVE

Lignes colorées pour 20 axes prioritaires !
Points pour les 45 autres axes !

👉 https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'papa-roulage-bot.onrender.com'}/carte`));

bot.command('liste', (ctx) => {
  const listeRues = rues.map(r => `• ${r.nom}`).join('\n');
  ctx.reply(`📋 AXES PRIS EN CHARGE (${rues.length}) :\n\n${listeRues}`);
});

bot.command('stats', async (ctx) => {
  const stats = await getStatsWithCache();
  if (!stats || stats.topRues.length === 0) {
    return ctx.reply(`📊 Aucune donnée pour le moment.`);
  }
  let msg = `📊 RAPPORT DU TRAFIC - KINSHASA 📊\n\n🔴 TOP 5 :\n`;
  stats.topRues.forEach((r, i) => { msg += `${i+1}. ${r.rue} (${r.total})\n`; });
  if (stats.heurePointe) msg += `\n⏰ HEURE DE POINTE : ${stats.heurePointe.heure}h`;
  if (stats.jourPointe) msg += `\n📅 JOUR LE PLUS CHARGÉ : ${stats.jourPointe.jour}`;
  ctx.reply(msg);
});

const gererDemandeEtat = async (ctx, lieu) => {
  if (!lieu) return ctx.reply("❌ Exemple: /etat triomphal");
  let axe = null;
  for (const a of rues) {
    for (const alias of a.alias) {
      if (lieu.includes(alias)) { axe = a; break; }
    }
    if (axe) break;
  }
  if (!axe) {
    const recherche = fuse.search(lieu);
    if (recherche.length > 0) axe = recherche[0].item;
  }
  if (!axe) return ctx.reply(`❓ Axe non reconnu. /liste pour voir les axes.`);
  const dernier = await getDernierSignalement(axe.nom);
  if (dernier) {
    const minutes = Math.round((Date.now() - new Date(dernier.timestamp).getTime()) / 60000);
    let temps = `⏱️ Mis à jour il y a ${minutes} min.`;
    if (minutes >= 60) temps = `⚠️ Info datant d'il y a ${Math.floor(minutes / 60)}h`;
    ctx.reply(`📍 ${axe.nom}\n🚦 ${dernier.etat}\n${temps}\n\n🗺️ Carte : /carte`);
  } else {
    ctx.reply(`🟢 ${axe.nom} : Aucun signalement. Trafic fluide.`);
  }
};

bot.command('etat', (ctx) => {
  const lieu = ctx.message.text.replace('/etat', '').trim();
  gererDemandeEtat(ctx, lieu);
});

// ==========================================
// 6. TRAITEMENT DES MESSAGES
// ==========================================
bot.on('text', async (ctx) => {
  const texte = ctx.message.text.toLowerCase().trim();
  if (texte.startsWith('/')) return;
  console.log(`[MESSAGE] ${texte}`);

  if (texte.startsWith("état ") || texte.startsWith("etat ")) {
    const lieu = texte.replace(/^état\s+/i, '').replace(/^etat\s+/i, '').trim();
    return gererDemandeEtat(ctx, lieu);
  }

  let etat = comprendreIntention(texte);
  const axe = extraireLieu(texte);
  
  if (axe && !etat) return gererDemandeEtat(ctx, axe.nom);
  if (!axe && etat) {
    ctx.reply(`❓ Je vois un problème de trafic, mais À QUEL ENDROIT ?

Ex: "C'est mort à Socimat"
📋 Liste : /liste`);
    return;
  }
  if (axe && etat) {
    await sauvegarderSignalement(axe.nom, etat);
    ctx.reply(`✅ Papa Roulage a compris !

📍 ${axe.nom}
🚦 ${etat}
📝 "${ctx.message.text}"

🗺️ Carte : /carte`);
    return;
  }
  ctx.reply(`❓ Je n'ai pas compris.

Exemples :
• "C'est mort à Socimat" → 🔴 Bouchon
• "Ça roule bien sur le 30 Juin" → 🟢 Fluide
• "Accident à l'Échangeur" → ⚠️ Accident
• "/carte" pour voir la carte`);
});

// ==========================================
// 7. SERVEUR WEB HONO (API + CARTE)
// ==========================================
const app = new Hono();

app.get('/', (c) => c.text('Papa Roulage V4.3 API - Kinshasa running 🇨🇩'));

// API /trafic (sans lat/lon)
app.get('/api/trafic', async (c) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (rue) rue, etat, timestamp
      FROM signalements
      WHERE timestamp > NOW() - INTERVAL '48 hours'
      ORDER BY rue, timestamp DESC
    `);
    return c.json({ success: true, data: result.rows, total: result.rows.length });
  } catch (err) {
    console.error("❌ Erreur API /trafic :", err.message);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Carte avec lignes colorées + fallback points
app.get('/carte', (c) => {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
  <title>Papa Roulage - Trafic Kinshasa</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body { margin: 0; padding: 0; }
    #map { height: 100vh; width: 100%; }
    .legend {
      position: absolute;
      bottom: 20px;
      right: 20px;
      background: rgba(255,255,255,0.95);
      padding: 12px;
      border-radius: 8px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      z-index: 1000;
      font-family: sans-serif;
      font-size: 12px;
    }
    .title {
      position: absolute;
      top: 15px;
      left: 50%;
      transform: translateX(-50%);
      background: #2c3e50;
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      z-index: 1000;
      font-family: sans-serif;
      font-weight: bold;
      font-size: 14px;
      white-space: nowrap;
    }
    @media (max-width: 600px) {
      .title { font-size: 11px; top: 10px; white-space: normal; text-align: center; width: 90%; }
      .legend { bottom: 10px; right: 10px; padding: 8px; font-size: 10px; }
    }
  </style>
</head>
<body>
  <div class="title">🚗 PAPA ROULAGE - TRAFIC EN TEMPS RÉEL 🚗</div>
  <div id="map"></div>
  <div class="legend">
    <strong>Légende</strong><br>
    <span style="color:#e74c3c">🔴</span> Bouchon / Accident<br>
    <span style="color:#f39c12">🟡</span> Ralentissement<br>
    <span style="color:#2ecc71">🟢</span> Fluide<br>
    <span style="color:#95a5a6">⚪</span> Non spécifié<br>
    <hr>
    📍 <strong>65 axes couverts</strong><br>
    🟢 20 axes avec lignes colorées<br>
    🔵 45 axes avec points
  </div>
  <script>
    const map = L.map('map').setView([-4.34, 15.31], 12.5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap & CartoDB',
      maxZoom: 19
    }).addTo(map);
    
    const trafficLayer = L.layerGroup().addTo(map);

    // SEGMENTS POUR 20 AXES PRIORITAIRES
    const tracesRues = {
      "Boulevard du 30 Juin": [[-4.3140,15.3150],[-4.3180,15.3130],[-4.3225,15.3112],[-4.3260,15.3080],[-4.3300,15.3050]],
      "Avenue Kasa-Vubu": [[-4.3180,15.3100],[-4.3220,15.3130],[-4.3281,15.3156],[-4.3350,15.3180],[-4.3500,15.3000]],
      "Boulevard Lumumba": [[-4.3180,15.3250],[-4.3300,15.3380],[-4.3400,15.3500],[-4.3480,15.3650],[-4.3520,15.3780],[-4.3720,15.4150]],
      "Rond-point Ngaba": [[-4.3800,15.3420],[-4.3844,15.3475],[-4.3900,15.3520]],
      "Route de Matadi": [[-4.3400,15.2680],[-4.3480,15.2550],[-4.3550,15.2450],[-4.3650,15.2300]],
      "Avenue Bypass": [[-4.3680,15.3350],[-4.3750,15.3550],[-4.3950,15.3650]],
      "Avenue de la Libération": [[-4.3280,15.3050],[-4.3400,15.2900],[-4.3500,15.2800],[-4.3650,15.2700]],
      "Boulevard Triomphal": [[-4.3300,15.3020],[-4.3356,15.3050],[-4.3420,15.3080],[-4.3500,15.3120]],
      "Rond-point Victoire": [[-4.3260,15.3140],[-4.3280,15.3160],[-4.3320,15.3200]],
      "Rond-point UPN": [[-4.3600,15.2320],[-4.3650,15.2350],[-4.3700,15.2380]],
      "Carrefour Ngaliema": [[-4.3450,15.2720],[-4.3500,15.2750],[-4.3550,15.2780]],
      "Marché Central": [[-4.3160,15.3080],[-4.3180,15.3100],[-4.3220,15.3120]],
      "Carrefour Lemba": [[-4.3650,15.3300],[-4.3700,15.3350],[-4.3750,15.3400]],
      "Rond-point Kintambo": [[-4.3100,15.2920],[-4.3150,15.2950],[-4.3200,15.2980]],
      "Stade des Martyrs": [[-4.3320,15.3020],[-4.3356,15.3050],[-4.3400,15.3080]],
      "Tour de l'Échangeur": [[-4.3350,15.3450],[-4.3400,15.3500],[-4.3450,15.3550]],
      "Beach Ngobila": [[-4.3120,15.3020],[-4.3150,15.3050],[-4.3180,15.3080]],
      "Croisement Diplomate": [[-4.3200,15.3110],[-4.3220,15.3130],[-4.3240,15.3150]],
      "Rond-point Forescom": [[-4.3280,15.3140],[-4.3320,15.3160],[-4.3360,15.3180]],
      "Avenue du Commerce": [[-4.3180,15.3080],[-4.3200,15.3100],[-4.3220,15.3120]]
    };

    // POINTS CENTRAUX POUR LES 45 AUTRES AXES
    const pointsCentraux = {
      "Avenue Kimwenza": [-4.3950, 15.3450],
      "Boulevard Congo Japon (Poids Lourds)": [-4.3100, 15.3000],
      "Avenue du Tourisme (Route de Kinsuka)": [-4.3400, 15.2000],
      "Avenue de la Justice": [-4.3250, 15.3120],
      "Avenue des Huileries": [-4.3300, 15.3180],
      "Avenue Wangata": [-4.3350, 15.3220],
      "Avenue Flambeau": [-4.3380, 15.3250],
      "Avenue de l'École": [-4.3420, 15.3280],
      "Avenue du Port": [-4.3150, 15.3050],
      "Safricas": [-4.3420, 15.3540],
      "Asanef": [-4.3380, 15.3480],
      "Carrefour Camp Luka": [-4.3580, 15.2600],
      "Avenue ISTM": [-4.3300, 15.3180],
      "Petro Congo": [-4.3225, 15.3115],
      "Carrefour Kingabwa": [-4.3100, 15.2980],
      "Avenue Sendwe": [-4.3180, 15.3020],
      "Carrefour Zando": [-4.3260, 15.3160],
      "Rond-point Camp Kokolo": [-4.3500, 15.2750],
      "Rond-point Société": [-4.3220, 15.3120],
      "Marché de la Liberté": [-4.3550, 15.2900],
      "Marché Gambela": [-4.3600, 15.2850],
      "Marché de Matonge": [-4.3280, 15.3180],
      "Marché de Ndjili": [-4.3450, 15.3550],
      "Clinique Ngaliema": [-4.3520, 15.2700],
      "Hôpital du Cinquantenaire": [-4.3350, 15.3080],
      "Hôpital de l'ONATRA": [-4.3220, 15.3120],
      "Clinique Kinoise": [-4.3280, 15.3150],
      "INSS": [-4.3300, 15.3100],
      "ISTA": [-4.3800, 15.3450],
      "ISC": [-4.3350, 15.3200],
      "Lycée Bosangani": [-4.3380, 15.3220],
      "Collège Boboto": [-4.3400, 15.3250],
      "Carrefour Mbanza Lemba": [-4.3750, 15.3400],
      "Carrefour Kingasani": [-4.3450, 15.3480],
      "Carrefour Masina": [-4.3500, 15.3600],
      "Rond-point Kampeta": [-4.3220, 15.3080],
      "Rond-point Righini": [-4.3350, 15.3050],
      "Rond-point Mwana Mbuyi": [-4.3400, 15.3100],
      "Rond-point Sozacom": [-4.3480, 15.3150],
      "Stade Tata Raphaël": [-4.3280, 15.3120],
      "Palais de la Nation": [-4.3250, 15.3100],
      "Gare de Limete": [-4.3420, 15.3520],
      "Kinshasa Golf": [-4.3550, 15.2800]
    };

    function getColor(etat) {
      if (!etat) return '#95a5a6';
      if (etat.includes('BOUCHON') || etat.includes('ACCIDENT')) return '#e74c3c';
      if (etat.includes('RALENTISSEMENT')) return '#f39c12';
      if (etat.includes('FLUIDE')) return '#2ecc71';
      return '#95a5a6';
    }

    async function updateData() {
      try {
        const res = await fetch('/api/trafic');
        const json = await res.json();
        console.log("📊 Données reçues:", json.total, "signalements");
        
        if (json.success && json.data.length > 0) {
          trafficLayer.clearLayers();
          
          json.data.forEach(s => {
            const color = getColor(s.etat);
            const date = new Date(s.timestamp).toLocaleTimeString('fr-FR', { 
              timeZone: 'Africa/Kinshasa', 
              hour: '2-digit', 
              minute: '2-digit' 
            });
            
            // CAS 1 : Ligne tracée
            const points = tracesRues[s.rue];
            if (points && points.length > 0) {
              L.polyline(points, { color: color, weight: 6, opacity: 0.85 })
                .addTo(trafficLayer)
                .bindPopup('<b>' + s.rue + '</b><br>🚦 ' + s.etat + '<br>🕐 ' + date);
            } 
            // CAS 2 : Point central
            else {
              const coords = pointsCentraux[s.rue];
              if (coords) {
                L.marker(coords, {
                  icon: L.divIcon({
                    html: '<div style="background-color:' + color + ';width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.5);"></div>',
                    iconSize: [14, 14]
                  })
                }).addTo(trafficLayer).bindPopup('<b>' + s.rue + '</b><br>🚦 ' + s.etat + '<br>🕐 ' + date);
              }
            }
          });
        }
      } catch(e) { console.error("❌ Erreur:", e); }
    }
    
    updateData();
    setInterval(updateData, 20000);
  </script>
</body>
</html>`;
  return c.html(html);
});

app.post('/webhook', async (c) => {
  try {
    const update = await c.req.json();
    await bot.handleUpdate(update);
    return c.text('OK');
  } catch (err) {
    console.error('Erreur webhook:', err);
    return c.text('Error', 500);
  }
});

// ==========================================
// 8. DÉMARRAGE
// ==========================================
const PORT = process.env.PORT || 3000;
serve({ fetch: app.fetch, port: Number(PORT) });
console.log(`🌍 Serveur Web sur le port ${PORT}`);

(async () => {
  try {
    const hostname = process.env.RENDER_EXTERNAL_HOSTNAME;
    if (hostname) {
      await bot.telegram.setWebhook(`https://${hostname}/webhook`);
      console.log(`🔗 Webhook configuré : https://${hostname}/webhook`);
    } else {
      await bot.telegram.deleteWebhook();
      bot.launch();
      console.log("🤖 Mode Polling actif");
    }
  } catch (err) {
    console.log("⚠️ Erreur webhook :", err.message);
    bot.launch();
  }
})();