---
name: testing-attribution
description: Génère un message d'attribution des tests pour la fin de sprint, groupé par membre et par epic, uniquement pour les tickets "Terminé(e)"
disable-model-invocation: true
---

Génère un rapport d'attribution des tests pour le dernier sprint ouvert.

## Environnement technique
- Windows uniquement
- Utiliser UNIQUEMENT Node.js pour tout traitement de données (jamais python, jamais python3)
- Utiliser `%TEMP%` comme répertoire temporaire (jamais /tmp)
- Toujours écrire les scripts Node dans un fichier .js temporaire plutôt qu'en ligne avec -e, pour éviter les problèmes d'échappement
- Format des chemins Windows : utiliser des slashes forward (/) ou doubler les backslashes (\\)

## Étapes

1. Utilise l'Atlassian MCP pour récupérer tous les tickets du sprint actif avec ce JQL :
   `project = LP AND sprint in openSprints() AND status = "Terminé(e)" ORDER BY key ASC`

   Champs à récupérer : summary, assignee, parent, issuetype, status, customfield_10020

2. Sauvegarde le résultat brut dans `%TEMP%/jira_sprint.json` via Bash

3. Écris un fichier Node.js `%TEMP%/build_teams_msg.js` avec ce contenu exact :
```js
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(process.env.TEMP, 'jira_sprint.json'), 'utf8');
const issues = JSON.parse(raw);

const testers = ['Kenji', 'Jérôme', 'Benjamin', 'Michael'];
const testerMap = {
   'Kenji Tetard': 'Kenji',
   'Jérôme Ceccaldi': 'Jérôme',
   'Benjamin Grand': 'Benjamin',
   'Michael Tasev': 'Michael'
};
const testerCounts = { Kenji: 0, Jérôme: 0, Benjamin: 0, Michael: 0 };

const tickets = [];
for (const i of issues) {
    const f = i.fields;
    const issuetype = f?.issuetype?.name || '';
    if (['Subtask', 'Sub-task', 'Sous-tâche'].includes(issuetype)) continue;

    const key = i.key;
    const summary = f?.summary || '';
    const assigneeDisplay = f?.assignee?.displayName || 'Non assigné';
    const epicName = f?.parent?.fields?.summary || 'Sans Epic';

    let tester;
    if (testerMap[assigneeDisplay]) {
        tester = testerMap[assigneeDisplay];
    } else {
        tester = testers.reduce((a, b) => testerCounts[a] <= testerCounts[b] ? a : b);
    }
    testerCounts[tester]++;
    tickets.push({ key, summary, epicName, tester });
}

const grouped = {};
for (const t of testers) grouped[t] = {};
for (const t of tickets) {
    if (!grouped[t.tester][t.epicName]) grouped[t.tester][t.epicName] = [];
    grouped[t.tester][t.epicName].push(t);
}

const sprintName = 'Sprint actif';
const totalTickets = tickets.length;
const totalEpics = new Set(tickets.map(t => t.epicName)).size;
const today = new Date().toLocaleDateString('fr-FR');

const lines = [];
lines.push(' **Attribution des Tests — ' + sprintName + '**');
lines.push('📅 ' + today + ' · ' + totalTickets + ' tickets · 4 membres · ' + totalEpics + ' epics');
lines.push('---');

for (const tester of testers) {
    const epics = grouped[tester];
    const count = Object.values(epics).reduce((s, arr) => s + arr.length, 0);
    lines.push('**' + tester + '** — ' + count + ' tickets');
    for (const [epic, items] of Object.entries(epics)) {
        lines.push('*' + epic + '*');
        for (const item of items) {
            lines.push('• `' + item.key + '` ' + item.summary);
        }
    }
    lines.push('---');
}

lines.push('📊 **Récap** : ' + totalTickets + ' tickets répartis entre 4 membres sur ' + totalEpics + ' epics.');
lines.push('---');
lines.push("**Tests d'usage courant** *(à faire en plus)*");
lines.push('*Authentification & compte*');
lines.push('• Création de compte');
lines.push('• Réinitialisation du mot de passe');
lines.push('*Onboarding*');
lines.push("• Parcours complet d'onboarding");
lines.push('*Gestion du compte / entreprise*');
lines.push('• Accès et modification des informations du profil');
lines.push('*Paiement & abonnement*');
lines.push('• Ajout / modification / suppression de moyen de paiement');
lines.push('---');

const msg = lines.join('\n\n');
fs.writeFileSync(path.join(process.env.TEMP, 'teams_msg.txt'), msg, 'utf8');
console.log('MSG_START');
console.log(msg);
console.log('MSG_END');
```

4. Exécute le script :
```
node %TEMP%/build_teams_msg.js
```

5. Récupère le contenu entre `MSG_START` et `MSG_END` et affiche-le dans le terminal avec ce préambule :
```
════════════════════════════════════════════
📋 APERÇU DU MESSAGE TEAMS
════════════════════════════════════════════

[contenu du message ici]

════════════════════════════════════════════
```

6. Demande confirmation à l'utilisateur :
```
Veux-tu envoyer ce message dans le canal Teams ? (oui/non)
```
Attends la réponse de l'utilisateur avant de continuer.

7. Si la réponse est "oui", "o", "yes" ou "y" (insensible à la casse) :

   Écris le fichier `%TEMP%/send_teams.js` avec ce contenu exact :
```js
const https = require('https');
const fs = require('fs');
const path = require('path');

const msg = fs.readFileSync(path.join(process.env.TEMP, 'teams_msg.txt'), 'utf8');
const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
const url = new URL(webhookUrl);

const body = JSON.stringify({ text: msg });

const options = {
  hostname: url.hostname,
  path: url.pathname + url.search,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
};

const req = https.request(options, (res) => {
  console.log('HTTP Status:', res.statusCode);
  if (res.statusCode === 200) {
    console.log('✅ Message envoyé dans Teams avec succès !');
  } else {
    console.log('❌ Erreur envoi Teams, status:', res.statusCode);
  }
});

req.on('error', (e) => console.error('❌ Erreur réseau:', e.message));
req.write(body);
req.end();
```

Puis exécute : `node %TEMP%/send_teams.js`

8. Si la réponse est "non", "n" ou toute autre réponse :
```
⏭️ Envoi annulé. Le message est sauvegardé dans %TEMP%/teams_msg.txt si tu changes d'avis.
```
Ne pas envoyer, ne pas écrire send_teams.js.

## Règles
- TOUJOURS utiliser Node.js, jamais python ou python3
- TOUJOURS écrire les scripts dans des fichiers .js dans %TEMP% avant de les exécuter
- JAMAIS utiliser /tmp — toujours %TEMP%
- JAMAIS utiliser curl pour l'envoi Teams — utiliser Node.js https
- TOUJOURS afficher le message complet et attendre la confirmation avant d'envoyer
- JAMAIS envoyer sans confirmation explicite de l'utilisateur
- Inclure UNIQUEMENT les tickets avec le statut "Terminé(e)"
- Ne pas inclure les sous-tâches
- Ne pas inventer de données — utiliser uniquement ce que Jira retourne
- Garder les titres des tickets tels quels