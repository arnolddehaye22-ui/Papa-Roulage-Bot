const { Telegraf } = require('telegraf');
const Fuse = require('fuse.js');
const { Hono } = require('hono');
const { serve } = require('@hono/node-server');

console.log("=== 🚗 PAPA ROULAGE V3.4 (ETAT CORRIGÉ) 🚗 ===");

// ==========================================
// 1. DICTIONNAIRE ENRICHI (AVEC POINTS DE REPÈRE)
// ==========================================
const rues = [
  { nom: "Boulevard du 30 Juin", alias: ["30 juin", "bd du 30", "trente juin", "bld 30", "grand boulevard", "socimat", "gare centrale", "royal", "batetela", "kitambo magasin"] },
  { nom: "Avenue Kasa-Vubu", alias: ["kasa vubu", "kasa", "av kasa", "kasavubu", "rond-point victoire", "victoire"] },
  { nom: "Boulevard Triomphal", alias: ["triomphal", "bd triomphal", "triomphale", "palais du peuple", "stade des martyrs"] },
  { nom: "Rond-point Ngaba", alias: ["ngaba", "rp ngaba", "rond point ngaba", "triangle"] },
  { nom: "Avenue de la Libération", alias: ["liberation", "ex 24 novembre", "24 novembre", "24 nov", "bandal", "moulaert"] },
  { nom: "Route de Matadi", alias: ["route matadi", "matadi", "binza", "delvaux", "upn"] },
  { nom: "Boulevard Lumumba", alias: ["lumumba", "bd lumumba", "route de l'aeroport", "ndjili", "pascal", "kingasani", "limete", "echangeur"] }
];

// Configuration des priorités fortes
const priorites = [
  { mots: ["bd du 30", "30 juin", "bld 30", "socimat", "gare centrale", "royal", "batetela"], rue: "Boulevard du 30 Juin" },
  { mots: ["kasa vubu", "kasa", "kasavubu", "victoire"], rue: "Avenue Kasa-Vubu" },
  { mots: ["ngaba", "triangle"], rue: "Rond-point Ngaba" },
  { mots: ["triomphal", "palais du peuple", "stade des martyrs"], rue: "Boulevard Triomphal" },
  { mots: ["liberation", "24 novembre", "24 nov", "bandal"], rue: "Avenue de la Libération" },
  { mots: ["matadi", "binza", "delvaux", "upn"], rue: "Route de Matadi" },
  { mots: ["lumumba", "ndjili", "pascal", "kingasani", "limete", "echangeur"], rue: "Boulevard Lumumba" }
];

const fuse = new Fuse(rues, {
  keys: [{ name: 'alias', weight: 2 }, { name: 'nom', weight: 1 }],
  threshold: 0.35
});

// Mémoire des signalements
const signalements = {};

// ==========================================
// 2. LE BOT TELEGRAM
// ==========================================
const bot = new Telegraf('8058425054:AAE8AzAJv6wZgGPZ6zMyIqJjLrX-dmdh4a8');

// Commande /start
bot.start((ctx) => {
  ctx.reply(`🇨🇩 PAPA ROULAGE V3.4 - PRÊT À RÉGULER LE TRAFIC ! 🇨🇩

📢 SIGNALER UN PROBLÈME :
"Bouchon à Socimat"
"Accident à l'Échangeur"
"Fluide sur UPN"

🔍 CONSULTER L'ÉTAT :
"/etat UPN" ou "etat upn" (sans slash !)

📋 LISTE : /liste
❓ AIDE : /aide

Restons solidaires sur la route ! 🚗`);
});

// Commande /aide
bot.command('aide', (ctx) => {
  ctx.reply(`🇨🇩 AIDE PAPA ROULAGE 🇨🇩

📢 SIGNALER :
"Bouchon à Socimat" → 30 Juin
"Accident Échangeur" → Lumumba
"Fluide sur UPN" → Matadi

🔍 CONSULTER :
/etat UPN  ou  "etat upn"

📍 LIEUX RECONNUS :
• 30 Juin (Socimat, Gare, Royal)
• Kasa-Vubu (Victoire)
• Ngaba (Triangle)
• Lumumba (Échangeur, Ndjili)
• Triomphal (Palais du Peuple)
• Libération (24 novembre)
• Matadi (Binza, UPN, Delvaux)

💡 Exemple : "Bouchon upn"`);
});

// Commande /liste
bot.command('liste', (ctx) => {
  const listeRues = rues.map(r => `• ${r.nom}`).join('\n');
  ctx.reply(`📋 RUES CONNUES :\n\n${listeRues}\n\nAbréviations : "bd du 30", "kasa", "ngaba", "upn"...`);
});

// Commande /etat normale
bot.command('etat', (ctx) => {
  const texte = ctx.message.text.toLowerCase().replace('/etat', '').trim();
  
  console.log(`[DEBUG] /etat reçu pour : "${texte}"`);
  
  if (!texte) {
    ctx.reply("❌ Exemple: `/etat upn` ou `etat upn`");
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
  
  if (rueTrouvee && signalements[rueTrouvee]) {
    const s = signalements[rueTrouvee];
    const minutes = Math.round((Date.now() - s.timestamp) / 60000);
    
    let temps = `⏱️ Signalé il y a ${minutes} min.`;
    if (minutes === 0) temps = "⏱️ Signalé à l'instant ! 🔥";
    if (minutes === 1) temps = "⏱️ Signalé il y a 1 minute.";
    if (minutes >= 60) {
      const heures = Math.floor(minutes / 60);
      temps = `⚠️ Info datant d'il y a ${heures}h (peut être obsolète)`;
    }

    ctx.reply(`📍 ${rueTrouvee}\n🚦 ${s.etat}\n${temps}\n\n🇨🇩 PAPA ROULAGE`);
  } else if (rueTrouvee) {
    ctx.reply(`🤷‍♂️ Aucun signalement pour ${rueTrouvee}. Tout semble fluide !`);
  } else {
    ctx.reply(`❓ Je n'ai pas reconnu "${texte}".\n\nTape /liste pour voir les lieux.`);
  }
});

// ==========================================
// TRAITEMENT UNIQUE : signalements + "etat" sans slash
// ==========================================
bot.on('text', async (ctx) => {
  let texte = ctx.message.text.toLowerCase();
  
  // 👉 CAS 1 : "etat upn" ou "état upn" (sans slash)
  if (texte.startsWith("état ") || texte.startsWith("etat ")) {
    const lieu = texte.replace(/^état /i, '').replace(/^etat /i, '').trim();
    console.log(`[DEBUG] "etat" transformé pour : "${lieu}"`);
    
    // Chercher la rue
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
    
    if (rueTrouvee && signalements[rueTrouvee]) {
      const s = signalements[rueTrouvee];
      const minutes = Math.round((Date.now() - s.timestamp) / 60000);
      let temps = `⏱️ Signalé il y a ${minutes} min.`;
      if (minutes === 0) temps = "⏱️ Signalé à l'instant ! 🔥";
      if (minutes === 1) temps = "⏱️ Signalé il y a 1 minute.";
      
      ctx.reply(`📍 ${rueTrouvee}\n🚦 ${s.etat}\n${temps}\n\n🇨🇩 PAPA ROULAGE`);
    } else if (rueTrouvee) {
      ctx.reply(`🤷‍♂️ Aucun signalement pour ${rueTrouvee}. Tout semble fluide !`);
    } else {
      ctx.reply(`❓ Je n'ai pas reconnu "${lieu}".\n\nTape /liste pour les lieux.`);
    }
    return;
  }
  
  // 👉 CAS 2 : Commande normale (commence par /)
  if (texte.startsWith('/')) return;
  
  // 👉 CAS 3 : Signalement normal
  console.log(`[DEBUG] Signalement reçu : "${texte}"`);
  
  let rueTrouvee = null;
  for (const priorite of priorites) {
    for (const mot of priorite.mots) {
      if (texte.includes(mot)) {
        rueTrouvee = priorite.rue;
        console.log(`[DEBUG] Priorité : "${mot}" → ${rueTrouvee}`);
        break;
      }
    }
    if (rueTrouvee) break;
  }
  
  if (!rueTrouvee) {
    const recherche = fuse.search(texte);
    if (recherche.length > 0) {
      rueTrouvee = recherche[0].item.nom;
      console.log(`[DEBUG] Fuse.js : ${rueTrouvee}`);
    }
  }
  
  // Demander le lieu si absent
  if (!rueTrouvee) {
    if (texte.includes("bouchon") || texte.includes("accident") || texte.includes("fluide") || texte.includes("ralenti")) {
      ctx.reply(`❓ " ${texte} " mais À QUEL ENDROIT ?\n\nExemples :\n"Bouchon à Socimat"\n"Accident à l'Échangeur"\n"Fluide sur UPN"`);
      return;
    }
    ctx.reply(`❓ Lieu non reconnu. Tape /liste pour voir les axes.`);
    return;
  }
  
  // Déterminer l'état
  let etat = "📢 INFORMATION";
  if (texte.includes("bouchon") || texte.includes("embouteillage") || texte.includes("bloqué") || texte.includes("coincé") || texte.includes("gros")) {
    etat = "🔴 BOUCHON / BLOCAGE TOTAL";
  } else if (texte.includes("accident") || texte.includes("cogné") || texte.includes("choc")) {
    etat = "⚠️ ACCIDENT SUR LA VOIE ⚠️";
  } else if (texte.includes("fluide") || texte.includes("calme") || texte.includes("rien") || texte.includes("normal") || texte.includes("vide")) {
    etat = "🟢 FLUIDE / ÇA ROULE BIEN";
  } else if (texte.includes("ralenti") || texte.includes("lent") || texte.includes("petit")) {
    etat = "🟡 RALENTISSEMENT LÉGER";
  }
  
  // Sauvegarder
  signalements[rueTrouvee] = {
    etat: etat,
    timestamp: Date.now()
  };
  
  ctx.reply(`✅ REÇU !\n\n📍 ${rueTrouvee}\n🚦 ${etat}\n\nTape "etat ${rueTrouvee}" pour consulter.`);
  console.log(`[LOG] ${rueTrouvee} → ${etat}`);
});

// Lancement
bot.launch();
console.log("🤖 PAPA ROULAGE V3.4 ACTIF !");

// ==========================================
// 3. SERVEUR WEB POUR RENDER
// ==========================================
const app = new Hono();
app.get('/', (c) => c.text('Papa Roulage V3.4 en ligne ! 🇨🇩'));

const port = process.env.PORT || 3000;
serve({ fetch: app.fetch, port: Number(port) });
console.log(`🌍 Serveur Web sur le port ${port}`);