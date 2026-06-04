const { Telegraf } = require('telegraf');
const { Pool } = require('pg');
const Fuse = require('fuse.js');
const { Hono } = require('hono');
const { serve } = require('@hono/node-server');

console.log("=== 🚗 PAPA ROULAGE V3.9 (50 AXES) 🚗 ===");

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
        heure INTEGER
      )
    `);
    console.log("📊 Base de données PostgreSQL connectée !");
  } catch (err) {
    console.log("⚠️ Erreur base de données :", err.message);
  }
})();

// ==========================================
// 1. DICTIONNAIRE COMPLET (50 AXES)
// ==========================================
const rues = [
  // GRANDS AXES (12)
  { nom: "Boulevard du 30 Juin", alias: ["30 juin", "bd du 30", "trente juin", "bld 30", "grand boulevard", "socimat", "gare centrale", "royal", "batetela", "kitambo magasin", "gombé", "gombe"] },
  { nom: "Avenue Kasa-Vubu", alias: ["kasa vubu", "kasa", "av kasa", "kasavubu", "rond-point victoire", "victoire", "central", "bandal", "mariage"] },
  { nom: "Boulevard Triomphal", alias: ["triomphal", "bd triomphal", "triomphale", "palais du peuple", "stade des martyrs", "martyrs"] },
  { nom: "Rond-point Ngaba", alias: ["ngaba", "rp ngaba", "rond point ngaba", "triangle", "universite", "université"] },
  { nom: "Avenue de la Libération", alias: ["liberation", "ex 24 novembre", "24 novembre", "24 nov", "bandal", "moulaert", "selembao"] },
  { nom: "Route de Matadi", alias: ["route matadi", "matadi", "binza", "delvaux", "upn", "barriere", "pompage", "lalou"] },
  { nom: "Boulevard Lumumba", alias: ["lumumba", "bd lumumba", "route de l'aeroport", "ndjili", "pascal", "kingasani", "limete", "echangeur", "échangeur", "quartier 1", "q1", "masina"] },
  { nom: "Avenue Bypass", alias: ["bypass", "by-pass", "by pass", "cite verte", "cité verte", "rimeo"] },
  { nom: "Avenue de l'Université", alias: ["universite", "université", "livulu", "intendance", "unikin", "yolo", "kapela"] },
  { nom: "Boulevard Congo Japon (Poids Lourds)", alias: ["poids lourds", "poids lourd", "congo japon", "congo-japon", "gare centrale", "baramoto", "kingabwa"] },
  { nom: "Avenue du Tourisme (Route de Kinsuka)", alias: ["tourisme", "av du tourisme", "kinsuka", "pompage", "mimosa", "fleuve"] },
  { nom: "Avenue Kimwenza", alias: ["kimwenza", "yolo", "av kimwenza", "kapela", "kala"] },
  
  // PETITES ARTÈRES (8)
  { nom: "Avenue du Commerce", alias: ["commerce", "av commerce", "grande poste", "kin marche", "kinmarché", "poste"] },
  { nom: "Avenue de la Justice", alias: ["justice", "palais de justice", "cour", "av justice"] },
  { nom: "Avenue des Huileries", alias: ["huileries", "huilco", "sodeico", "av huileries", "huile"] },
  { nom: "Avenue Wangata", alias: ["wangata", "funa", "stade", "av wangata", "wangata funa"] },
  { nom: "Avenue Flambeau", alias: ["flambeau", "clair", "lumière", "av flambeau"] },
  { nom: "Rond-point Forescom", alias: ["forescom", "forecom", "rp forescom"] },
  { nom: "Avenue de l'École", alias: ["ecole", "école", "av ecole", "lycee", "lycée"] },
  { nom: "Avenue du Port", alias: ["port", "av port", "beach", "ngobila", "beach ngobila"] },
  
  // MARCHÉS (5)
  { nom: "Marché Central", alias: ["marché central", "grand marché", "central"] },
  { nom: "Marché de la Liberté", alias: ["marché liberté", "liberté", "marché gambela", "gambela"] },
  { nom: "Marché Gambela", alias: ["gambela", "marche gambela"] },
  { nom: "Marché de Matonge", alias: ["matonge", "marché matonge"] },
  { nom: "Marché de Ndjili", alias: ["marché ndjili", "ndjili marché"] },
  
  // HÔPITAUX & CLINIQUES (4)
  { nom: "Clinique Ngaliema", alias: ["ngaliema", "clinique ngaliema", "hôpital ngaliema"] },
  { nom: "Hôpital du Cinquantenaire", alias: ["cinquantenaire", "hôpital 50 ans", "50 ans"] },
  { nom: "Hôpital de l'ONATRA", alias: ["onatra", "hôpital onatra"] },
  { nom: "Clinique Kinoise", alias: ["clinique kinoise", "kinoise"] },
  
  // ÉCOLES & UNIVERSITÉS (5)
  { nom: "INSS", alias: ["inss", "inss kasa vubu"] },
  { nom: "ISTA", alias: ["ista", "ista ngaba"] },
  { nom: "ISC", alias: ["isc", "isc kin"] },
  { nom: "Lycée Bosangani", alias: ["bosangani", "lycee bosangani"] },
  { nom: "Collège Boboto", alias: ["boboto", "college boboto"] },
  
  // CARREFOURS STRATÉGIQUES (4)
  { nom: "Carrefour Lemba", alias: ["lemba", "carrefour lemba", "lemba marche"] },
  { nom: "Carrefour Mbanza Lemba", alias: ["mbanza lemba", "mbanza"] },
  { nom: "Carrefour Kingasani", alias: ["kingasani carrefour", "kingasani"] },
  { nom: "Carrefour Masina", alias: ["masina carrefour", "masina"] },
  
  // ROND-POINTS SUPPLÉMENTAIRES (5)
  { nom: "Rond-point Kintambo", alias: ["kintambo", "rp kintambo", "rond point kintambo"] },
  { nom: "Rond-point Kampeta", alias: ["kampeta", "rp kampeta"] },
  { nom: "Rond-point Righini", alias: ["righini", "rp righini"] },
  { nom: "Rond-point Mwana Mbuyi", alias: ["mwana mbuyi", "rp mwana mbuyi"] },
  { nom: "Rond-point Sozacom", alias: ["sozacom", "rp sozacom"] },
  
  // AUTRES POINTS DE REPÈRE (7)
  { nom: "Stade des Martyrs", alias: ["martyrs", "stade martyrs", "stade"] },
  { nom: "Stade Tata Raphaël", alias: ["tata raphaël", "tata", "tata raphael"] },
  { nom: "Palais de la Nation", alias: ["palais nation", "palais"] },
  { nom: "Tour de l'Échangeur", alias: ["tour echangeur", "tour"] },
  { nom: "Gare de Limete", alias: ["gare limete", "limete gare"] },
  { nom: "Beach Ngobila", alias: ["beach", "ngobila"] },
  { nom: "Kinshasa Golf", alias: ["golf", "golf kinshasa"] }
];

// ==========================================
// 2. CONFIGURATION DES PRIORITÉS
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
  
  // Marchés (5)
  { mots: ["marché central", "grand marché"], rue: "Marché Central" },
  { mots: ["marché liberté", "liberté", "gambela"], rue: "Marché de la Liberté" },
  { mots: ["gambela"], rue: "Marché Gambela" },
  { mots: ["matonge"], rue: "Marché de Matonge" },
  { mots: ["marché ndjili", "ndjili marché"], rue: "Marché de Ndjili" },
  
  // Hôpitaux (4)
  { mots: ["ngaliema", "clinique ngaliema"], rue: "Clinique Ngaliema" },
  { mots: ["cinquantenaire", "50 ans"], rue: "Hôpital du Cinquantenaire" },
  { mots: ["onatra"], rue: "Hôpital de l'ONATRA" },
  { mots: ["clinique kinoise", "kinoise"], rue: "Clinique Kinoise" },
  
  // Écoles (5)
  { mots: ["inss"], rue: "INSS" },
  { mots: ["ista"], rue: "ISTA" },
  { mots: ["isc"], rue: "ISC" },
  { mots: ["bosangani"], rue: "Lycée Bosangani" },
  { mots: ["boboto"], rue: "Collège Boboto" },
  
  // Carrefours (4)
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

async function sauvegarderSignalement(rue, etat) {
  const maintenant = new Date();
  const jour = maintenant.toLocaleDateString('fr-FR', { weekday: 'long' });
  const heure = maintenant.getHours();
  
  try {
    await pool.query(
      'INSERT INTO signalements (rue, etat, jour, heure) VALUES ($1, $2, $3, $4)',
      [rue, etat, jour, heure]
    );
    console.log(`💾 Signalement sauvegardé : ${rue} → ${etat}`);
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
    if (result.rows.length > 0) {
      return {
        etat: result.rows[0].etat,
        timestamp: new Date(result.rows[0].timestamp).getTime()
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
  ctx.reply(`🇨🇩 PAPA ROULAGE V3.9 - 50 AXES DISPONIBLES ! 🇨🇩

📢 SIGNALER UN PROBLÈME :
"Bouchon à Commerce"
"Accident à Matonge"

🔍 CONSULTER L'ÉTAT :
"/etat Commerce" ou "etat commerce"

📊 STATISTIQUES : /stats
📋 LISTE : /liste
❓ AIDE : /aide

50 lieux stratégiques couverts ! 🚗`);
});

bot.command('aide', (ctx) => {
  ctx.reply(`🇨🇩 PAPA ROULAGE V3.9 🇨🇩

📢 SIGNALER :
"Bouchon à Commerce"
"Accident à Matonge"
"Fluide à Kintambo"

🔍 CONSULTER :
/etat [lieu]  ou  "etat [lieu]"

📊 STATISTIQUES : /stats

📍 CATÉGORIES (50 lieux) :
• Grands axes : 30 Juin, Kasa-Vubu, Lumumba...
• Marchés : Central, Liberté, Gambela, Matonge, Ndjili
• Hôpitaux : Ngaliema, Cinquantenaire, ONATRA
• Écoles : INSS, ISTA, ISC, Bosangani, Boboto
• Carrefours : Lemba, Mbanza Lemba, Kingasani, Masina
• Rond-points : Kintambo, Kampeta, Righini, Mwana Mbuyi, Sozacom
• Lieux publics : Stades, Palais, Tour, Beach, Golf

💡 Plus on signale, plus les stats sont précises !`);
});

bot.command('liste', (ctx) => {
  const listeRues = rues.map(r => `• ${r.nom}`).join('\n');
  ctx.reply(`📋 TOUS LES AXES RECONNUS (${rues.length}) :\n\n${listeRues}\n\n💡 Utilise les alias : "commerce", "matonge", "ngaliema", "lemba"...`);
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
  
  message += `\n\n💡 Plus on signale, plus les stats sont précises !`;
  ctx.reply(message);
});

bot.command('etat', async (ctx) => {
  const texte = ctx.message.text.toLowerCase().replace('/etat', '').trim();
  
  if (!texte) {
    ctx.reply("❌ Exemple: `/etat commerce` ou `etat commerce`");
    return;
  }

  let rueTrouvee = null;
  for (const priorite of priorites) {
    for (const mot of priorite.mots) {
      if (texte.includes(mot)) { rueTrouvee = priorite.rue; break; }
    }
    if (rueTrouvee) break;
  }
  
  if (!rueTrouvee) {
    const recherche = fuse.search(texte);
    if (recherche.length > 0) rueTrouvee = recherche[0].item.nom;
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
      ctx.reply(`📍 ${rueTrouvee}\n🚦 ${dernier.etat}\n${temps}\n\n🇨🇩 PAPA ROULAGE`);
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
    for (const priorite of priorites) {
      for (const mot of priorite.mots) {
        if (lieu.includes(mot)) { rueTrouvee = priorite.rue; break; }
      }
      if (rueTrouvee) break;
    }
    
    if (!rueTrouvee) {
      const recherche = fuse.search(lieu);
      if (recherche.length > 0) rueTrouvee = recherche[0].item.nom;
    }
    
    if (rueTrouvee) {
      const dernier = await getDernierSignalement(rueTrouvee);
      if (dernier) {
        const minutes = Math.round((Date.now() - dernier.timestamp) / 60000);
        let temps = `⏱️ Signalé il y a ${minutes} min.`;
        if (minutes === 0) temps = "⏱️ Signalé à l'instant ! 🔥";
        if (minutes >= 60) temps = `⚠️ Il y a ${Math.floor(minutes / 60)}h`;
        ctx.reply(`📍 ${rueTrouvee}\n🚦 ${dernier.etat}\n${temps}\n\n🇨🇩 PAPA ROULAGE`);
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
  for (const priorite of priorites) {
    for (const mot of priorite.mots) {
      if (texte.includes(mot)) {
        rueTrouvee = priorite.rue;
        break;
      }
    }
    if (rueTrouvee) break;
  }
  
  if (!rueTrouvee) {
    const recherche = fuse.search(texte);
    if (recherche.length > 0) rueTrouvee = recherche[0].item.nom;
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
      ctx.reply(`💡 État actuel de ${rueTrouvee} : ${dernier.etat} (⏱️ ${minutes} min)\n\nPour signaler un changement, écris "Bouchon ${rueTrouvee}"`);
    } else {
      ctx.reply(`🤷‍♂️ Aucun signalement pour ${rueTrouvee}. Que se passe-t-il ?\n\nExemple : "Bouchon ${rueTrouvee}"`);
    }
    return;
  }
  
  if (!rueTrouvee && etat) {
    ctx.reply(`❓ "${ctx.message.text}"... mais À QUEL ENDROIT ?\n\nExemples :\n"Bouchon Commerce"\n"Accident Matonge"\n"Fluide Kintambo"`);
    return;
  }
  
  if (!rueTrouvee && !etat) {
    ctx.reply(`❓ Je n'ai pas bien compris.\n\n• Signalement : "Bouchon Commerce"\n• Consultation : "etat commerce"\n• Liste : /liste\n• Aide : /aide`);
    return;
  }
  
  await sauvegarderSignalement(rueTrouvee, etat);
  ctx.reply(`✅ REÇU !\n\n📍 ${rueTrouvee}\n🚦 ${etat}\n\nTape "etat ${rueTrouvee}" pour consulter.`);
  console.log(`[LOG] ${rueTrouvee} → ${etat}`);
});

// ==========================================
// 6. SERVEUR WEBHOOK
// ==========================================
const app = new Hono();
app.get('/', (c) => c.text('Papa Roulage V3.9 en ligne ! 50 axes 🇨🇩'));
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

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await bot.telegram.deleteWebhook();
    const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || 'papa-roulage-bot.onrender.com';
    const url = `https://${hostname}/webhook`;
    await bot.telegram.setWebhook(url);
    console.log(`🔗 Webhook configuré : ${url}`);
    console.log("🤖 PAPA ROULAGE V3.9 ACTIF !");
    console.log(`📊 ${rues.length} axes disponibles`);
  } catch (err) {
    console.log("⚠️ Erreur webhook :", err.message);
    bot.launch();
  }
})();

serve({ fetch: app.fetch, port: PORT });
console.log(`🌍 Serveur Web sur le port ${PORT}`);