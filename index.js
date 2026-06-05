const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
const Fuse = require('fuse.js');
const { Hono } = require('hono');
const { serve } = require('@hono/node-server');

console.log("=== 🚗 PAPA ROULAGE V4.0 (65 AXES + GPS + BDD) 🚗 ===");

// ==========================================
// 0. CONNEXION À LA BASE POSTGRESQL
// ==========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Création de la table si elle n'existe pas
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS signalements (
        id SERIAL PRIMARY KEY,
        rue TEXT NOT NULL,
        etat TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT NOW(),
        jour TEXT,
        heure INTEGER,
        lat DOUBLE PRECISION,
        lon DOUBLE PRECISION
      )
    `);
    console.log("📊 Base de données PostgreSQL connectée !");
  } catch (err) {
    console.log("⚠️ Erreur base de données :", err.message);
  }
})();

// ==========================================
// 1. DICTIONNAIRE V4.0 (65 AXES AVEC COORDONNÉES GPS)
// ==========================================
const rues = [
  // GRANDS AXES (12)
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
  
  // PETITES ARTÈRES (8)
  { nom: "Avenue du Commerce", lat: -4.3200, lon: 15.3080, alias: ["commerce", "av commerce", "grande poste", "kin marche", "kinmarché", "poste"] },
  { nom: "Avenue de la Justice", lat: -4.3250, lon: 15.3120, alias: ["justice", "palais de justice", "cour", "av justice"] },
  { nom: "Avenue des Huileries", lat: -4.3300, lon: 15.3180, alias: ["huileries", "huilco", "sodeico", "av huileries", "huile"] },
  { nom: "Avenue Wangata", lat: -4.3350, lon: 15.3220, alias: ["wangata", "funa", "stade", "av wangata", "wangata funa"] },
  { nom: "Avenue Flambeau", lat: -4.3380, lon: 15.3250, alias: ["flambeau", "clair", "lumière", "av flambeau"] },
  { nom: "Rond-point Forescom", lat: -4.3320, lon: 15.3160, alias: ["forescom", "forecom", "rp forescom"] },
  { nom: "Avenue de l'École", lat: -4.3420, lon: 15.3280, alias: ["ecole", "école", "av ecole", "lycee", "lycée"] },
  { nom: "Avenue du Port", lat: -4.3150, lon: 15.3050, alias: ["port", "av port", "beach", "ngobila", "beach ngobila"] },
  
  // AXES/CROISEMENTS MAJEURS (10)
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
  
  // CARREFOURS MAJEURS (4)
  { nom: "Rond-point Victoire", lat: -4.3280, lon: 15.3160, alias: ["victoire", "rp victoire", "rond point victoire", "victoire kasa vubu"] },
  { nom: "Rond-point UPN", lat: -4.3650, lon: 15.2350, alias: ["upn", "rp upn", "rond point upn", "upn matadi"] },
  { nom: "Rond-point Camp Kokolo", lat: -4.3500, lon: 15.2750, alias: ["camp kokolo", "rp kokolo", "kokolo", "camp"] },
  { nom: "Rond-point Société", lat: -4.3220, lon: 15.3120, alias: ["société", "rp société", "societe", "rp societe"] },
  
  // MARCHÉS (5)
  { nom: "Marché Central", lat: -4.3180, lon: 15.3100, alias: ["marché central", "grand marché", "central"] },
  { nom: "Marché de la Liberté", lat: -4.3550, lon: 15.2900, alias: ["marché liberté", "liberté", "marché gambela", "gambela"] },
  { nom: "Marché Gambela", lat: -4.3600, lon: 15.2850, alias: ["gambela", "marche gambela"] },
  { nom: "Marché de Matonge", lat: -4.3280, lon: 15.3180, alias: ["matonge", "marché matonge"] },
  { nom: "Marché de Ndjili", lat: -4.3450, lon: 15.3550, alias: ["marché ndjili", "ndjili marché"] },
  
  // HÔPITAUX & CLINIQUES (4)
  { nom: "Clinique Ngaliema", lat: -4.3520, lon: 15.2700, alias: ["ngaliema", "clinique ngaliema", "hôpital ngaliema"] },
  { nom: "Hôpital du Cinquantenaire", lat: -4.3350, lon: 15.3080, alias: ["cinquantenaire", "hôpital 50 ans", "50 ans"] },
  { nom: "Hôpital de l'ONATRA", lat: -4.3220, lon: 15.3120, alias: ["onatra", "hôpital onatra"] },
  { nom: "Clinique Kinoise", lat: -4.3280, lon: 15.3150, alias: ["clinique kinoise", "kinoise"] },
  
  // ÉCOLES & UNIVERSITÉS (5)
  { nom: "INSS", lat: -4.3300, lon: 15.3100, alias: ["inss", "inss kasa vubu"] },
  { nom: "ISTA", lat: -4.3800, lon: 15.3450, alias: ["ista", "ista ngaba"] },
  { nom: "ISC", lat: -4.3350, lon: 15.3200, alias: ["isc", "isc kin"] },
  { nom: "Lycée Bosangani", lat: -4.3380, lon: 15.3220, alias: ["bosangani", "lycee bosangani"] },
  { nom: "Collège Boboto", lat: -4.3400, lon: 15.3250, alias: ["boboto", "college boboto"] },
  
  // CARREFOURS STRATÉGIQUES (4)
  { nom: "Carrefour Lemba", lat: -4.3700, lon: 15.3350, alias: ["lemba", "carrefour lemba", "lemba marche"] },
  { nom: "Carrefour Mbanza Lemba", lat: -4.3750, lon: 15.3400, alias: ["mbanza lemba", "mbanza"] },
  { nom: "Carrefour Kingasani", lat: -4.3450, lon: 15.3480, alias: ["kingasani carrefour", "kingasani"] },
  { nom: "Carrefour Masina", lat: -4.3500, lon: 15.3600, alias: ["masina carrefour", "masina"] },
  
  // ROND-POINTS SUPPLÉMENTAIRES (5)
  { nom: "Rond-point Kintambo", lat: -4.3150, lon: 15.2950, alias: ["kintambo", "rp kintambo", "rond point kintambo"] },
  { nom: "Rond-point Kampeta", lat: -4.3220, lon: 15.3080, alias: ["kampeta", "rp kampeta"] },
  { nom: "Rond-point Righini", lat: -4.3350, lon: 15.3050, alias: ["righini", "rp righini"] },
  { nom: "Rond-point Mwana Mbuyi", lat: -4.3400, lon: 15.3100, alias: ["mwana mbuyi", "rp mwana mbuyi"] },
  { nom: "Rond-point Sozacom", lat: -4.3480, lon: 15.3150, alias: ["sozacom", "rp sozacom"] },
  
  // AUTRES POINTS DE REPÈRE (7)
  { nom: "Stade des Martyrs", lat: -4.3350, lon: 15.3050, alias: ["martyrs", "stade martyrs", "stade"] },
  { nom: "Stade Tata Raphaël", lat: -4.3280, lon: 15.3120, alias: ["tata raphaël", "tata", "tata raphael"] },
  { nom: "Palais de la Nation", lat: -4.3250, lon: 15.3100, alias: ["palais nation", "palais"] },
  { nom: "Tour de l'Échangeur", lat: -4.3400, lon: 15.3500, alias: ["tour echangeur", "tour"] },
  { nom: "Gare de Limete", lat: -4.3420, lon: 15.3520, alias: ["gare limete", "limete gare"] },
  { nom: "Beach Ngobila", lat: -4.3150, lon: 15.3050, alias: ["beach", "ngobila"] },
  { nom: "Kinshasa Golf", lat: -4.3550, lon: 15.2800, alias: ["golf", "golf kinshasa"] }
];

// ==========================================
// 2. CONFIGURATION DES PRIORITÉS (65 AXES)
// ==========================================
const priorites = [
  // Grands axes (12)
  { mots: ["bd du 30", "30 juin", "bld 30", "socimat", "gare centrale", "royal", "batetela", "kitambo magasin"], rue: "Boulevard du 30 Juin" },
  { mots: ["kasa vubu", "kasa", "kasavubu", "victoire"], rue: "Avenue Kasa-Vubu" },
  { mots: ["ngaba", "triangle"], rue: "Rond-point Ngaba" },
  { mots: ["triomphal", "palais du peuple", "stade des martyrs"], rue: "Boulevard Triomphal" },
  { mots: ["liberation", "24 novembre", "24 nov", "bandal", "moulaert"], rue: "Avenue de la Libération" },
  { mots: ["matadi", "binza", "delvaux", "upn", "pompage"], rue: "Route de Matadi" },
  { mots: ["lumumba", "ndjili", "pascal", "kingasani", "limete", "echangeur", "échangeur"], rue: "Boulevard Lumumba" },
  { mots: ["bypass", "by-pass", "by pass", "cite verte", "cité verte", "rimeo"], rue: "Avenue Bypass" },
  { mots: ["unikin", "livulu", "intendance", "universite", "université", "yolo", "kapela"], rue: "Avenue de l'Université" },
  { mots: ["poids lourds", "poids lourd", "congo japon", "congo-japon", "baramoto"], rue: "Boulevard Congo Japon (Poids Lourds)" },
  { mots: ["tourisme", "kinsuka", "mimosa", "pompage"], rue: "Avenue du Tourisme (Route de Kinsuka)" },
  { mots: ["kimwenza", "kapela"], rue: "Avenue Kimwenza" },
  
  // Petites artères (8)
  { mots: ["commerce", "grande poste", "kin marche", "kinmarché"], rue: "Avenue du Commerce" },
  { mots: ["justice", "palais de justice", "cour"], rue: "Avenue de la Justice" },
  { mots: ["huileries", "huilco", "sodeico", "huile"], rue: "Avenue des Huileries" },
  { mots: ["wangata", "funa", "stade"], rue: "Avenue Wangata" },
  { mots: ["flambeau", "clair"], rue: "Avenue Flambeau" },
  { mots: ["forescom", "forecom", "rp forescom"], rue: "Rond-point Forescom" },
  { mots: ["ecole", "école", "lycee", "lycée"], rue: "Avenue de l'École" },
  { mots: ["port", "beach", "ngobila"], rue: "Avenue du Port" },
  
  // Axes/Croisements majeurs (10)
  { mots: ["diplomate", "diplo"], rue: "Croisement Diplomate" },
  { mots: ["safricas", "safrica"], rue: "Safricas" },
  { mots: ["asanef"], rue: "Asanef" },
  { mots: ["camp luka", "luka"], rue: "Carrefour Camp Luka" },
  { mots: ["istm"], rue: "Avenue ISTM" },
  { mots: ["petro", "petro congo"], rue: "Petro Congo" },
  { mots: ["kingabwa", "kinga"], rue: "Carrefour Kingabwa" },
  { mots: ["sendwe"], rue: "Avenue Sendwe" },
  { mots: ["zando"], rue: "Carrefour Zando" },
  { mots: ["magasin", "rp magasin", "rond point magasin"], rue: "Carrefour Ngaliema" },
  
  // Carrefours majeurs (4)
  { mots: ["victoire", "rp victoire", "rond point victoire"], rue: "Rond-point Victoire" },
  { mots: ["upn rp", "rp upn", "rond point upn"], rue: "Rond-point UPN" },
  { mots: ["camp kokolo", "rp kokolo", "kokolo"], rue: "Rond-point Camp Kokolo" },
  { mots: ["société", "rp société", "societe", "rp societe"], rue: "Rond-point Société" },
  
  // Marchés (5)
  { mots: ["marché central", "grand marché"], rue: "Marché Central" },
  { mots: ["marché liberté", "liberté", "gambela"], rue: "Marché de la Liberté" },
  { mots: ["gambela"], rue: "Marché Gambela" },
  { mots: ["matonge"], rue: "Marché de Matonge" },
  { mots: ["marché ndjili", "ndjili marché"], rue: "Marché de Ndjili" },
  
  // Hôpitaux (4)
  { mots: ["ngaliema clinique", "clinique ngaliema"], rue: "Clinique Ngaliema" },
  { mots: ["cinquantenaire", "50 ans"], rue: "Hôpital du Cinquantenaire" },
  { mots: ["onatra"], rue: "Hôpital de l'ONATRA" },
  { mots: ["clinique kinoise", "kinoise"], rue: "Clinique Kinoise" },
  
  // Écoles (5)
  { mots: ["inss"], rue: "INSS" },
  { mots: ["ista"], rue: "ISTA" },
  { mots: ["isc"], rue: "ISC" },
  { mots: ["bosangani"], rue: "Lycée Bosangani" },
  { mots: ["boboto"], rue: "Collège Boboto" },
  
  // Carrefours stratégiques (4)
  { mots: ["lemba", "carrefour lemba"], rue: "Carrefour Lemba" },
  { mots: ["mbanza lemba", "mbanza"], rue: "Carrefour Mbanza Lemba" },
  { mots: ["kingasani carrefour"], rue: "Carrefour Kingasani" },
  { mots: ["masina carrefour"], rue: "Carrefour Masina" },
  
  // Rond-points supplémentaires (5)
  { mots: ["kintambo", "rp kintambo"], rue: "Rond-point Kintambo" },
  { mots: ["kampeta", "rp kampeta"], rue: "Rond-point Kampeta" },
  { mots: ["righini", "rp righini"], rue: "Rond-point Righini" },
  { mots: ["mwana mbuyi", "rp mwana mbuyi"], rue: "Rond-point Mwana Mbuyi" },
  { mots: ["sozacom", "rp sozacom"], rue: "Rond-point Sozacom" },
  
  // Autres (7)
  { mots: ["martyrs", "stade martyrs"], rue: "Stade des Martyrs" },
  { mots: ["tata raphaël", "tata"], rue: "Stade Tata Raphaël" },
  { mots: ["palais nation", "palais"], rue: "Palais de la Nation" },
  { mots: ["tour echangeur", "tour"], rue: "Tour de l'Échangeur" },
  { mots: ["gare limete"], rue: "Gare de Limete" },
  { mots: ["beach"], rue: "Beach Ngobila" },
  { mots: ["golf kinshasa", "golf"], rue: "Kinshasa Golf" }
];

const fuse = new Fuse(rues, {
  keys: [{ name: 'alias', weight: 2 }, { name: 'nom', weight: 1 }],
  threshold: 0.45,
  ignoreLocation: true
});

// ==========================================
// 3. FONCTIONS BASE DE DONNÉES
// ==========================================

async function sauvegarderSignalement(rue, etat, lat, lon) {
  const maintenant = new Date();
  const jour = maintenant.toLocaleDateString('fr-FR', { weekday: 'long' });
  const heure = maintenant.getHours();
  
  try {
    await pool.query(
      'INSERT INTO signalements (rue, etat, jour, heure, lat, lon) VALUES ($1, $2, $3, $4, $5, $6)',
      [rue, etat, jour, heure, lat, lon]
    );
    console.log(`💾 Signalement sauvegardé : ${rue} → ${etat}`);
  } catch (err) {
    console.error("❌ Erreur sauvegarde :", err.message);
  }
}

async function getDernierSignalement(rue) {
  try {
    const result = await pool.query(
      'SELECT etat, timestamp, lat, lon FROM signalements WHERE rue = $1 ORDER BY timestamp DESC LIMIT 1',
      [rue]
    );
    if (result.rows.length > 0) {
      return {
        etat: result.rows[0].etat,
        timestamp: new Date(result.rows[0].timestamp).getTime(),
        lat: result.rows[0].lat,
        lon: result.rows[0].lon
      };
    }
    return null;
  } catch (err) {
    console.error("❌ Erreur lecture :", err.message);
    return null;
  }
}

async function getStats() {
  try {
    const topRues = await pool.query(
      `SELECT rue, COUNT(*) as total FROM signalements 
       GROUP BY rue ORDER BY total DESC LIMIT 5`
    );
    
    const heurePointe = await pool.query(
      `SELECT heure, COUNT(*) as total FROM signalements 
       GROUP BY heure ORDER BY total DESC LIMIT 1`
    );
    
    const jourPointe = await pool.query(
      `SELECT jour, COUNT(*) as total FROM signalements 
       GROUP BY jour ORDER BY total DESC LIMIT 1`
    );
    
    return { topRues: topRues.rows, heurePointe: heurePointe.rows[0], jourPointe: jourPointe.rows[0] };
  } catch (err) {
    console.error("❌ Erreur stats :", err.message);
    return null;
  }
}

// ==========================================
// 4. LE BOT TELEGRAM
// ==========================================
const bot = new Telegraf(process.env.BOT_TOKEN || '8058425054:AAE8AzAJv6wZgGPZ6zMyIqJjLrX-dmdh4a8');

bot.start((ctx) => {
  ctx.reply(`🇨🇩 PAPA ROULAGE V4.0 - 65 AXES AVEC CARTE ! 🇨🇩

📢 SIGNALER UN PROBLÈME :
"Bouchon à Commerce"
"Accident à Matonge"
"Bouchon magasin"

🔍 CONSULTER L'ÉTAT :
"/etat Commerce" ou "etat commerce"

🗺️ VOIR LA CARTE : /carte
📊 STATISTIQUES : /stats
📋 LISTE : /liste
❓ AIDE : /aide

65 lieux stratégiques couverts ! 🚗`);
});

bot.command('carte', (ctx) => {
  ctx.reply(`🗺️ PAPA ROULAGE - CARTE INTERACTIVE

Découvre tous les bouchons en temps réel sur une carte de Kinshasa !

👉 https://papa-roulage-bot.onrender.com/carte

Partage ce lien avec tous les conducteurs ! 🚗💨`);
});

bot.command('aide', (ctx) => {
  ctx.reply(`🇨🇩 PAPA ROULAGE V4.0 - AIDE 🇨🇩

📢 SIGNALER :
"Bouchon à Commerce"
"Accident à Matonge"
"Fluide à Kintambo"
"Bouchon magasin"

🔍 CONSULTER :
/etat [lieu]  ou  "etat [lieu]"

🗺️ CARTE : /carte
📊 STATISTIQUES : /stats
📋 LISTE DES LIEUX : /liste

📍 65 LIEUX DISPONIBLES :
Grands axes, Marchés, Hôpitaux, Écoles, Carrefours, Rond-points...

💡 Plus on signale, plus la carte est précise !`);
});

bot.command('liste', (ctx) => {
  const listeRues = rues.map(r => `• ${r.nom}`).join('\n');
  ctx.reply(`📋 TOUS LES AXES RECONNUS (${rues.length}) :\n\n${listeRues}\n\n💡 Utilise les alias : "commerce", "matonge", "magasin", "victoire"...`);
});

bot.command('stats', async (ctx) => {
  const stats = await getStats();
  
  if (!stats || stats.topRues.length === 0) {
    ctx.reply(`📊 PAS ENCORE DE STATISTIQUES

Aucun signalement enregistré pour le moment.
Sois le premier à signaler un bouchon !`);
    return;
  }
  
  let message = `📊 RAPPORT PAPA ROULAGE 📊\n\n`;
  message += `🔴 TOP 5 AXES LES PLUS SIGNALÉS :\n`;
  stats.topRues.forEach((rue, i) => {
    message += `${i+1}. ${rue.rue} → ${rue.total} signalements\n`;
  });
  
  if (stats.heurePointe) {
    message += `\n⏰ HEURE DE POINTE : ${stats.heurePointe.heure}h (${stats.heurePointe.total} signalements)`;
  }
  
  if (stats.jourPointe) {
    message += `\n📅 JOUR LE PLUS CHARGÉ : ${stats.jourPointe.jour}`;
  }
  
  message += `\n\n💡 Plus on signale, plus les stats sont précises !\n🗺️ Carte interactive : /carte`;
  ctx.reply(message);
});

bot.command('etat', async (ctx) => {
  const texte = ctx.message.text.toLowerCase().replace('/etat', '').trim();
  
  if (!texte) {
    ctx.reply("❌ Exemple: `/etat commerce` ou `etat commerce`");
    return;
  }

  let rueTrouvee = null;
  let lat = null, lon = null;
  
  for (const priorite of priorites) {
    for (const mot of priorite.mots) {
      if (texte.includes(mot)) { 
        rueTrouvee = priorite.rue;
        const axe = rues.find(r => r.nom === rueTrouvee);
        if (axe) { lat = axe.lat; lon = axe.lon; }
        break;
      }
    }
    if (rueTrouvee) break;
  }
  
  if (!rueTrouvee) {
    const recherche = fuse.search(texte);
    if (recherche.length > 0) {
      rueTrouvee = recherche[0].item.nom;
      lat = recherche[0].item.lat;
      lon = recherche[0].item.lon;
    }
  }
  
  if (rueTrouvee) {
    const dernier = await getDernierSignalement(rueTrouvee);
    if (dernier) {
      const minutes = Math.round((Date.now() - dernier.timestamp) / 60000);
      let temps = `⏱️ Signalé il y a ${minutes} min.`;
      if (minutes === 0) temps = "⏱️ Signalé à l'instant ! 🔥";
      if (minutes === 1) temps = "⏱️ Signalé il y a 1 minute.";
      if (minutes >= 60) {
        const heures = Math.floor(minutes / 60);
        temps = `⚠️ Info datant d'il y a ${heures}h (peut être obsolète)`;
      }
      ctx.reply(`📍 ${rueTrouvee}\n🚦 ${dernier.etat}\n${temps}\n\n🗺️ Voir sur la carte : https://papa-roulage-bot.onrender.com/carte\n\n🇨🇩 PAPA ROULAGE`);
    } else {
      ctx.reply(`🤷‍♂️ Aucun signalement pour ${rueTrouvee}. Tout semble fluide !`);
    }
  } else {
    ctx.reply(`❓ Je n'ai pas reconnu "${texte}".\n\nTape /liste pour voir les ${rues.length} lieux.`);
  }
});

// ==========================================
// 5. TRAITEMENT DES MESSAGES
// ==========================================
bot.on('text', async (ctx) => {
  let texte = ctx.message.text.toLowerCase().trim();
  
  // "etat commerce" sans slash
  if (texte.startsWith("état ") || texte.startsWith("etat ")) {
    const lieu = texte.replace(/^état /i, '').replace(/^etat /i, '').trim();
    
    let rueTrouvee = null;
    let lat = null, lon = null;
    
    for (const priorite of priorites) {
      for (const mot of priorite.mots) {
        if (lieu.includes(mot)) { 
          rueTrouvee = priorite.rue;
          const axe = rues.find(r => r.nom === rueTrouvee);
          if (axe) { lat = axe.lat; lon = axe.lon; }
          break;
        }
      }
      if (rueTrouvee) break;
    }
    
    if (!rueTrouvee) {
      const recherche = fuse.search(lieu);
      if (recherche.length > 0) {
        rueTrouvee = recherche[0].item.nom;
        lat = recherche[0].item.lat;
        lon = recherche[0].item.lon;
      }
    }
    
    if (rueTrouvee) {
      const dernier = await getDernierSignalement(rueTrouvee);
      if (dernier) {
        const minutes = Math.round((Date.now() - dernier.timestamp) / 60000);
        let temps = `⏱️ Signalé il y a ${minutes} min.`;
        if (minutes === 0) temps = "⏱️ Signalé à l'instant ! 🔥";
        if (minutes >= 60) temps = `⚠️ Il y a ${Math.floor(minutes / 60)}h`;
        ctx.reply(`📍 ${rueTrouvee}\n🚦 ${dernier.etat}\n${temps}\n\n🗺️ Carte : /carte`);
      } else {
        ctx.reply(`🤷‍♂️ Aucun signalement pour ${rueTrouvee}.`);
      }
    } else {
      ctx.reply(`❓ Je n'ai pas reconnu "${lieu}".\n\nTape /liste pour voir les ${rues.length} lieux.`);
    }
    return;
  }
  
  if (texte.startsWith('/')) return;
  
  console.log(`[DEBUG] Message reçu : "${texte}"`);
  
  let rueTrouvee = null;
  let lat = null, lon = null;
  
  for (const priorite of priorites) {
    for (const mot of priorite.mots) {
      if (texte.includes(mot)) {
        rueTrouvee = priorite.rue;
        const axe = rues.find(r => r.nom === rueTrouvee);
        if (axe) { lat = axe.lat; lon = axe.lon; }
        break;
      }
    }
    if (rueTrouvee) break;
  }
  
  if (!rueTrouvee) {
    const recherche = fuse.search(texte);
    if (recherche.length > 0) {
      rueTrouvee = recherche[0].item.nom;
      lat = recherche[0].item.lat;
      lon = recherche[0].item.lon;
    }
  }
  
  let etat = null;
  if (texte.includes("bouchon") || texte.includes("embouteillage") || texte.includes("bloqué") || texte.includes("coincé") || texte.includes("gros")) {
    etat = "🔴 BOUCHON / BLOCAGE TOTAL";
  } else if (texte.includes("accident") || texte.includes("cogné") || texte.includes("choc")) {
    etat = "⚠️ ACCIDENT SUR LA VOIE ⚠️";
  } else if (texte.includes("fluide") || texte.includes("calme") || texte.includes("rien") || texte.includes("normal") || texte.includes("vide")) {
    etat = "🟢 FLUIDE / ÇA ROULE BIEN";
  } else if (texte.includes("ralenti") || texte.includes("lent") || texte.includes("petit")) {
    etat = "🟡 RALENTISSEMENT LÉGER";
  }
  
  if (rueTrouvee && !etat) {
    const dernier = await getDernierSignalement(rueTrouvee);
    if (dernier) {
      const minutes = Math.round((Date.now() - dernier.timestamp) / 60000);
      ctx.reply(`💡 État actuel de ${rueTrouvee} : ${dernier.etat} (⏱️ ${minutes} min)\n\nPour signaler un changement, écris "Bouchon ${rueTrouvee}"\n🗺️ Voir sur la carte : /carte`);
    } else {
      ctx.reply(`🤷‍♂️ Aucun signalement pour ${rueTrouvee}. Que se passe-t-il ?\n\nExemple : "Bouchon ${rueTrouvee}"`);
    }
    return;
  }
  
  if (!rueTrouvee && etat) {
    ctx.reply(`❓ "${ctx.message.text}"... mais À QUEL ENDROIT ?\n\nExemples :\n"Bouchon Commerce"\n"Accident Matonge"\n"Fluide Kintambo"\n\nVoir la carte : /carte`);
    return;
  }
  
  if (!rueTrouvee && !etat) {
    ctx.reply(`❓ Je n'ai pas bien compris.\n\n• Signalement : "Bouchon Commerce"\n• Consultation : "etat commerce"\n• Carte : /carte\n• Liste : /liste\n• Aide : /aide`);
    return;
  }
  
  await sauvegarderSignalement(rueTrouvee, etat, lat, lon);
  ctx.reply(`✅ REÇU !\n\n📍 ${rueTrouvee}\n🚦 ${etat}\n\n🗺️ Voir sur la carte : https://papa-roulage-bot.onrender.com/carte\n\nTape "etat ${rueTrouvee}" pour consulter.`);
  console.log(`[LOG] ${rueTrouvee} → ${etat}`);
});

// ==========================================
// 6. SERVEUR WEB HONO (Routes API + Webhook)
// ==========================================
const app = new Hono();

// Route principale
app.get('/', (c) => c.text('Papa Roulage V4.0 en ligne ! 65 axes 🇨🇩'));

// Route API pour récupérer tous les signalements récents (pour la carte)
app.get('/api/trafic', async (c) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (rue) rue, etat, timestamp, lat, lon
      FROM signalements
      ORDER BY rue, timestamp DESC
    `);
    
    const traficAvecCoords = result.rows.map(signalement => {
      const axe = rues.find(r => r.nom === signalement.rue);
      return {
        rue: signalement.rue,
        etat: signalement.etat,
        timestamp: signalement.timestamp,
        lat: signalement.lat || axe?.lat,
        lon: signalement.lon || axe?.lon
      };
    }).filter(s => s.lat && s.lon);
    
    return c.json({ success: true, data: traficAvecCoords, total: traficAvecCoords.length });
  } catch (err) {
    console.error("❌ Erreur API :", err.message);
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Route pour la carte web
app.get('/carte', (c) => {
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Papa Roulage - Carte des bouchons Kinshasa</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
        #map { height: 100vh; width: 100%; }
        .legend {
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: white;
            padding: 10px 15px;
            border-radius: 8px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            z-index: 1000;
            font-size: 12px;
        }
        .legend h4 { margin: 0 0 5px 0; }
        .legend div { margin: 3px 0; }
        .red { color: #e74c3c; font-weight: bold; }
        .green { color: #2ecc71; font-weight: bold; }
        .orange { color: #f39c12; font-weight: bold; }
        .gray { color: #95a5a6; }
        .title {
            position: absolute;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: #2c3e50;
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            z-index: 1000;
            font-weight: bold;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        }
    </style>
</head>
<body>
    <div class="title">🚗 PAPA ROULAGE - Carte des bouchons Kinshasa 🚗</div>
    <div id="map"></div>
    <div class="legend">
        <h4>Légende</h4>
        <div><span class="red">🔴</span> Bouchon / Blocage</div>
        <div><span class="orange">🟡</span> Ralentissement</div>
        <div><span class="green">🟢</span> Fluide</div>
        <div><span class="gray">⚪</span> Information</div>
        <hr>
        <div>📊 Dernières infos en temps réel</div>
    </div>
    
    <script>
        const map = L.map('map').setView([-4.35, 15.31], 12);
        
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CartoDB',
            subdomains: 'abcd',
            maxZoom: 19
        }).addTo(map);
        
        function getMarkerColor(etat) {
            if (etat.includes('BOUCHON') || etat.includes('BLOCAGE')) return '#e74c3c';
            if (etat.includes('RALENTISSEMENT')) return '#f39c12';
            if (etat.includes('FLUIDE')) return '#2ecc71';
            return '#95a5a6';
        }
        
        function getMarkerIcon(color) {
            return L.divIcon({
                className: 'custom-marker',
                html: '<div style="background-color: ' + color + '; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px black;"></div>',
                iconSize: [14, 14],
                popupAnchor: [0, -7]
            });
        }
        
        async function chargerSignalements() {
            try {
                const reponse = await fetch('/api/trafic');
                const resultat = await reponse.json();
                
                if (resultat.success && resultat.data.length > 0) {
                    resultat.data.forEach(signalement => {
                        if (signalement.lat && signalement.lon) {
                            const color = getMarkerColor(signalement.etat);
                            const icon = getMarkerIcon(color);
                            
                            const date = new Date(signalement.timestamp);
                            const heure = date.toLocaleTimeString('fr-FR');
                            const age = Math.round((Date.now() - new Date(signalement.timestamp)) / 60000);
                            let ageTexte = age < 60 ? age + ' min' : Math.floor(age/60) + 'h' + (age%60) + 'min';
                            
                            L.marker([signalement.lat, signalement.lon], { icon: icon })
                                .addTo(map)
                                .bindPopup('<b>' + signalement.rue + '</b><br>🚦 ' + signalement.etat + '<br>🕐 Dernier signalement: ' + heure + ' (' + ageTexte + ')<br><i>Signalé par la communauté Papa Roulage</i>');
                        }
                    });
                }
            } catch (error) {
                console.error('Erreur chargement:', error);
            }
        }
        
        chargerSignalements();
        setInterval(chargerSignalements, 30000);
    </script>
</body>
</html>`;
  return c.html(html);
});

// Route webhook pour Telegram
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
// 7. LANCEMENT DU SERVEUR ET DU BOT
// ==========================================
const PORT = process.env.PORT || 3000;

serve({ fetch: app.fetch, port: PORT });
console.log(`🌍 Serveur Web sur le port ${PORT}`);

(async () => {
  try {
    await bot.telegram.deleteWebhook();
    const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || 'papa-roulage-bot.onrender.com';
    const url = `https://${hostname}/webhook`;
    await bot.telegram.setWebhook(url);
    console.log(`🔗 Webhook configuré : ${url}`);
    console.log("🤖 PAPA ROULAGE V4.0 ACTIF !");
    console.log(`📊 ${rues.length} axes disponibles`);
  } catch (err) {
    console.log("⚠️ Erreur webhook :", err.message);
    bot.launch();
  }
})();