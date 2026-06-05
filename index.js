const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
const Fuse = require('fuse.js');
const { Hono } = require('hono');
const { serve } = require('@hono/node-server');

console.log("=== 🚗 PAPA ROULAGE V4.1.1 (OPTIMISATIONS FINALES) ===");

// Forçage du fuseau horaire au niveau du processus Node.js
process.env.TZ = 'Africa/Kinshasa';

// ==========================================
// 0. CACHE POUR LES STATISTIQUES
// ==========================================
let statsCache = null;
let lastStatsUpdate = 0;
const STATS_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// ==========================================
// 1. CONNEXION À LA BASE POSTGRESQL
// ==========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Gestion des erreurs de connexion PostgreSQL pour éviter le crash
pool.on('error', (err) => {
  console.error('⚠️ Erreur inattendue sur un client PostgreSQL inactif :', err.message);
});

// Création de la table et des index
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS signalements (
        id SERIAL PRIMARY KEY,
        rue TEXT NOT NULL,
        etat TEXT NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        jour TEXT,
        heure INTEGER,
        lat DOUBLE PRECISION,
        lon DOUBLE PRECISION
      );
      CREATE INDEX IF NOT EXISTS idx_signalements_rue_timestamp ON signalements (rue, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_signalements_stats ON signalements (jour, heure);
      CREATE INDEX IF NOT EXISTS idx_signalements_timestamp ON signalements (timestamp);
    `);
    console.log("📊 Base de données PostgreSQL initialisée avec index de performance.");
  } catch (err) {
    console.error("⚠️ Erreur initialisation BDD :", err.message);
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

// Configuration Fuse.js OPTIMISÉE (threshold 0.3, poids alias 3)
const fuse = new Fuse(rues, {
  keys: [
    { name: 'alias', weight: 3 },
    { name: 'nom', weight: 1 }
  ],
  threshold: 0.3,
  ignoreLocation: true
});

// ==========================================
// 3. FONCTIONS BASE DE DONNÉES
// ==========================================
async function sauvegarderSignalement(rue, etat, lat, lon) {
  const maintenant = new Date();
  const jour = maintenant.toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'Africa/Kinshasa' });
  const heure = parseInt(maintenant.toLocaleTimeString('fr-FR', { hour: '2-digit', hour12: false, timeZone: 'Africa/Kinshasa' }));
  try {
    await pool.query(
      'INSERT INTO signalements (rue, etat, jour, heure, lat, lon) VALUES ($1, $2, $3, $4, $5, $6)',
      [rue, etat, jour, heure, lat, lon]
    );
    // Invalider le cache des stats après un nouveau signalement
    statsCache = null;
    console.log(`💾 Signalement enregistré : ${rue} → ${etat} (${jour} - ${heure}h)`);
  } catch (err) {
    console.error("❌ Erreur sauvegarde BDD :", err.message);
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
    console.error("❌ Erreur lecture BDD :", err.message);
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
    return { 
      topRues: topRues.rows, 
      heurePointe: heurePointe.rows[0], 
      jourPointe: jourPointe.rows[0] 
    };
  } catch (err) {
    console.error("❌ Erreur compilation stats :", err.message);
    return null;
  }
}

// Fonction avec cache pour les stats
async function getStatsWithCache() {
  const now = Date.now();
  if (statsCache && (now - lastStatsUpdate) < STATS_CACHE_TTL) {
    console.log("📊 Stats servies depuis le cache");
    return statsCache;
  }
  statsCache = await getStats();
  lastStatsUpdate = now;
  return statsCache;
}

// ==========================================
// 4. FONCTION CENTRALISÉE DE RECHERCHE
// ==========================================
function chercherRue(texte) {
  // Nettoyer le texte des mots parasites courants
  const texteNettoye = texte.replace(/\b(sur|à|au|dans|vers|pour|avec|de|du|des|et|le|la|les|un|une)\b/gi, '').trim();
  
  // Recherche par correspondance exacte sur un mot complet
  for (const axe of rues) {
    for (const alias of axe.alias) {
      const regex = new RegExp(`\\b${alias}\\b`, 'i');
      if (regex.test(texteNettoye)) {
        return axe;
      }
    }
  }
  // Fallback sur la recherche floue
  const recherche = fuse.search(texteNettoye);
  if (recherche.length > 0) {
    return recherche[0].item;
  }
  return null;
}

// ==========================================
// 5. LE BOT TELEGRAM (SÉCURISÉ)
// ==========================================
if (!process.env.BOT_TOKEN) {
  console.error("❌ ERREUR FATALE : Le BOT_TOKEN n'est pas défini dans l'environnement !");
  process.exit(1);
}
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply(`🇨🇩 PAPA ROULAGE V4.1.1 - OPTIMISATIONS FINALES ! 🚗

📢 POUR SIGNALER :
"Bouchon sur le 30 Juin"
"Accident à UPN"
"Fluide sur Bypass"

🔍 POUR CONSULTER :
"etat commerce" ou /etat Huileries

🗺️ CARTE INTERACTIVE : /carte
📊 STATISTIQUES : /stats
📋 AXES COUVERTS : /liste`);
});

bot.command('carte', (c) => c.reply(`🗺️ CARTOGRAPHIE PAPA ROULAGE

Suivez l'état du trafic en temps réel à Kinshasa :
👉 https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'papa-roulage-bot.onrender.com'}/carte`));

bot.command('liste', (ctx) => {
  const listeRues = rues.map(r => `• ${r.nom}`).join('\n');
  ctx.reply(`📋 AXES PRIS EN CHARGE (${rues.length}) :\n\n${listeRues}`);
});

bot.command('stats', async (ctx) => {
  const stats = await getStatsWithCache();
  if (!stats || stats.topRues.length === 0) {
    return ctx.reply(`📊 Aucune donnée collectée pour le moment.`);
  }
  let msg = `📊 RAPPORT DU TRAFIC - KINSHASA 📊\n\n🔴 TOP 5 DES AXES LES PLUS SENGORGÉS :\n`;
  stats.topRues.forEach((r, i) => { msg += `${i+1}. ${r.rue} (${r.total} signalements)\n`; });
  if (stats.heurePointe) msg += `\n⏰ HEURE CRITIQUE : ${stats.heurePointe.heure}h`;
  if (stats.jourPointe) msg += `\n📅 JOUR LE PLUS SOMBRE : ${stats.jourPointe.jour}`;
  ctx.reply(msg);
});

// Handler unifié pour la commande /etat
const gererDemandeEtat = async (ctx, lieu) => {
  if (!lieu) return ctx.reply("❌ Précisez un lieu. Exemple: /etat triomphal");
  
  const axe = chercherRue(lieu);
  if (!axe) return ctx.reply(`❓ Axe non reconnu. Tapez /liste pour voir les options disponibles.`);

  const dernier = await getDernierSignalement(axe.nom);
  if (dernier) {
    const minutes = Math.round((Date.now() - new Date(dernier.timestamp).getTime()) / 60000);
    let temps = `⏱️ Mis à jour il y a ${minutes} min.`;
    if (minutes >= 60) temps = `⚠️ Info datant d'il y a ${Math.floor(minutes / 60)}h (peut être obsolète)`;
    
    ctx.reply(`📍 ${axe.nom}\n🚦 ${dernier.etat}\n${temps}\n\n🗺️ Carte interactive : https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'papa-roulage-bot.onrender.com'}/carte`);
  } else {
    ctx.reply(`🟢 ${axe.nom} : Aucun signalement récent. Trafic à priori fluide !`);
  }
};

bot.command('etat', (ctx) => {
  const lieu = ctx.message.text.replace('/etat', '').trim();
  gererDemandeEtat(ctx, lieu);
});

// Traitement des messages texte
bot.on('text', async (ctx) => {
  const texte = ctx.message.text.toLowerCase().trim();
  if (texte.startsWith('/')) return;

  // Interception des demandes d'état textuelles "etat [lieu]"
  if (texte.startsWith("état ") || texte.startsWith("etat ")) {
    const lieu = texte.replace(/^état\s+/i, '').replace(/^etat\s+/i, '').trim();
    return gererDemandeEtat(ctx, lieu);
  }

  // Analyse syntaxique de l'état avec expressions régulières précises
  let etat = null;
  if (/\b(bouchon|embouteillage|bloqué|coincé|bouché|embouteillé)\b/.test(texte)) {
    etat = "🔴 BOUCHON / BLOCAGE TOTAL";
  } else if (/\b(accident|cogné|choc|tamponné)\b/.test(texte)) {
    etat = "⚠️ ACCIDENT SUR LA VOIE ⚠️";
  } else if (/\b(fluide|calme|normal|vide|ça roule|ca roule)\b/.test(texte)) {
    etat = "🟢 FLUIDE / ÇA ROULE BIEN";
  } else if (/\b(ralenti|lent|petit bouchon)\b/.test(texte)) {
    etat = "🟡 RALENTISSEMENT LÉGER";
  }

  const axe = chercherRue(texte);

  if (axe && etat) {
    await sauvegarderSignalement(axe.nom, etat, axe.lat, axe.lon);
    ctx.reply(`✅ Reçu par Papa Roulage !

📍 ${axe.nom}
🚦 ${etat}

Merci pour la communauté kinoise ! 🇨🇩`);
  } else if (axe && !etat) {
    return gererDemandeEtat(ctx, axe.nom);
  } else if (!axe && etat) {
    ctx.reply(`❓ C'est noté pour le problème de trafic, mais c'est à quel endroit exactement ?

Récrivez par exemple : "Bouchon sur Kasa-Vubu"`);
  } else {
    ctx.reply(`❓ Je n'ai pas bien compris votre message.

• Pour signaler : "Bouchon à Socimat"
• Pour consulter : "etat socimat"`);
  }
});

// ==========================================
// 6. SERVEUR WEB HONO
// ==========================================
const app = new Hono();

app.get('/', (c) => c.text('Papa Roulage V4.1.1 API - Kinshasa running 🇨🇩'));

// API /trafic avec filtrage des signalements de moins de 48h
app.get('/api/trafic', async (c) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (rue) rue, etat, timestamp, lat, lon
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

// Route de la carte avec fuseau horaire frontend
app.get('/carte', (c) => {
  const host = process.env.RENDER_EXTERNAL_HOSTNAME || 'papa-roulage-bot.onrender.com';
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Papa Roulage Live - Kinshasa</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body { margin: 0; padding: 0; }
    #map { height: 100vh; width: 100%; }
    .legend { position: absolute; bottom: 20px; right: 20px; background: white; padding: 12px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); z-index: 1000; font-family: sans-serif; font-size: 13px; }
    .title { position: absolute; top: 15px; left: 50%; transform: translateX(-50%); background: #2c3e50; color: white; padding: 10px 20px; border-radius: 20px; z-index: 1000; font-family: sans-serif; font-weight: bold; }
  </style>
</head>
<body>
  <div class="title">🚗 PAPA ROULAGE - TRAFIC KINSHASA 🚗</div>
  <div id="map"></div>
  <div class="legend">
    <strong>Légende :</strong><br>
    🔴 Bouchon Majeur<br>
    🟡 Ralentissement<br>
    🟢 Fluide<br>
    ⚪ Non spécifié
  </div>
  <script>
    const map = L.map('map').setView([-4.34, 15.31], 12.5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
    const markersGroup = L.layerGroup().addTo(map);

    function getColor(etat) {
      if (typeof etat !== 'string') return '#95a5a6';
      if (etat.includes('BOUCHON') || etat.includes('ACCIDENT')) return '#e74c3c';
      if (etat.includes('RALENTISSEMENT')) return '#f39c12';
      if (etat.includes('FLUIDE')) return '#2ecc71';
      return '#95a5a6';
    }

    async function updateData() {
      try {
        const res = await fetch('/api/trafic');
        const json = await res.json();
        if (json.success) {
          markersGroup.clearLayers();
          json.data.forEach(s => {
            if (s.lat && s.lon) {
              const markerIcon = L.divIcon({
                html: '<div style="background-color: ' + getColor(s.etat) + '; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
                className: 'custom-pin',
                iconSize: [16, 16]
              });
              // Fuseau horaire Kinshasa dans le frontend
              const date = new Date(s.timestamp).toLocaleTimeString('fr-FR', { 
                timeZone: 'Africa/Kinshasa', 
                hour: '2-digit', 
                minute: '2-digit' 
              });
              L.marker([s.lat, s.lon], { icon: markerIcon })
                .addTo(markersGroup)
                .bindPopup('<b>' + s.rue + '</b><br>🚦 ' + s.etat + '<br>🕐 Heure : ' + date);
            }
          });
        }
      } catch(e) { console.error(e); }
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
    console.error('Erreur Webhook invocation:', err);
    return c.text('Internal Server Error', 500);
  }
});

// ==========================================
// 7. DÉMARRAGE DU SERVEUR ET DU BOT
// ==========================================
const PORT = process.env.PORT || 3000;
serve({ fetch: app.fetch, port: Number(PORT) });
console.log(`🌍 Serveur Web sur le port ${PORT}`);

(async () => {
  try {
    const hostname = process.env.RENDER_EXTERNAL_HOSTNAME;
    if (hostname) {
      const url = `https://${hostname}/webhook`;
      await bot.telegram.setWebhook(url);
      console.log(`🔗 Webhook configuré sur la plateforme de prod : ${url}`);
    } else {
      await bot.telegram.deleteWebhook();
      bot.launch();
      console.log("🤖 Mode Polling actif localement.");
    }
  } catch (err) {
    console.log("⚠️ Échec d'enregistrement Webhook, repli sur le mode Polling :", err.message);
    bot.launch();
  }
})();