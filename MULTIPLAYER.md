# Battle sur téléphones

Le grand écran (ordinateur, TV) affiche la grille et fait tourner la partie. Chaque joueur joue depuis son téléphone, qui sert de manette.

## Lancer en local (wifi de la maison)

Il faut Node.js 22 ou plus récent, et que tous les appareils soient sur le même wifi.

```
npm install
npm run play
```

`npm run play` construit le jeu puis démarre le petit serveur (port 8080). Le terminal affiche deux adresses :

- **Grand écran** : `http://localhost:8080/` sur l'ordinateur.
- **Téléphones** : `http://192.168.x.x:8080/` (l'adresse réseau de l'ordinateur). Le QR code de la salle la contient déjà.

Sur le grand écran : **Modes** → **Battle sur téléphones**. Un code de 4 lettres et un QR code s'affichent. Chaque joueur scanne le QR code (ou ouvre l'adresse et tape le code), choisit son nom, sa boisson et sa place (Joueur 1 à 6). Quand au moins 2 places sont prises, **Lancer la partie**.

Si le téléphone n'arrive pas à ouvrir la page : le pare-feu de l'ordinateur bloque peut-être le port 8080, ou le wifi isole les appareils entre eux (réseau « invités »).

## Sur le téléphone

- Au début de la partie, un tirage au sort (visible sur tous les écrans en même temps) désigne qui commence.
- Changer de verre en pleine partie (bouton « Changer de verre ») : le nouveau verre est plein, les parts déjà bues et les points restent.
- Lancer les spins quand c'est son tour, attaquer, se défendre, acheter des free spins, passer.
- La boutique (prix d'attaque et de bouclier pour son verre) se met à jour en direct avec ses points.
- Les points, les verres et les boucliers de tout le monde sont visibles en temps réel.
- Quand quelqu'un est attaqué, la roue s'affiche sur tous les téléphones et sur le grand écran en même temps. Seul le joueur attaqué choisit (boire ou tenter la roue).
- Un téléphone qui perd le réseau (ou se met en veille) reprend sa place tout seul en revenant. Il suffit de rouvrir la page avec le même téléphone.
- Si le téléphone du joueur dont c'est le tour est hors ligne, les boutons réapparaissent sur le grand écran pour jouer à sa place.

## Mini jeux

À la fin de chaque tour complet (quand tous les joueurs ont joué), un mini jeu a lieu : le grand écran affiche le jeu, les téléphones servent de manettes. Le jeu change à chaque tour (jamais deux fois le même d'affilée).

- **Récompenses :** à 4 joueurs ou plus, le 1er gagne 50 points et le 2e 25 points. À moins de 4 joueurs, seul le 1er gagne 30 points.
- **Click Rush :** taper le plus vite possible pendant 5 secondes.
- **Flappy Course :** chacun dans son couloir, on tape pour battre des ailes, le dernier en vol gagne.
- **Bomberman :** croix directionnelle et bouton bombe, le dernier debout gagne.
- **Agar.io :** joystick, on mange des billes puis les plus petits.
- **Snake.io :** croix directionnelle, le dernier serpent en vie gagne.

Le code des jeux est dans `src/mini/` (un fichier par jeu, sans rien d'affichage à part leur dessin), l'écran du grand écran dans `src/battle/miniHost.ts` et les manettes dans `src/controller/main.ts`.

## Comment c'est fait

```
server/server.mjs      Serveur : sert le jeu, gère les salles, relaie les messages (aucune règle de jeu)
src/battle/remote.ts   Grand écran : ouvre la salle, reçoit les demandes des téléphones
src/battle/ui.ts       Contient la partie : vérifie chaque demande (bon joueur, bon moment, assez de points)
src/controller/        La page téléphone (controller.html)
src/net/               Messages échangés (protocol.ts) et connexion qui se rétablit toute seule (socket.ts)
```

Le grand écran garde l'état de la partie : les téléphones envoient des demandes, le grand écran les vérifie, les applique et renvoie une image de la partie à tous. Si on ferme la page du grand écran, la partie s'arrête. Un téléphone ne peut agir que pour son joueur.

## Héberger en ligne plus tard

Le serveur est un seul fichier Node (`server/server.mjs`) qui ne dépend que de `ws` : il tourne sur n'importe quel hébergeur qui exécute Node et accepte les WebSockets. Commande de démarrage : `npm run play` (construit puis lance), variable `PORT` fournie par l'hébergeur.

Pistes gratuites ou peu chères (les offres changent : à vérifier au moment de choisir) :

- **Render** : service web Node gratuit, mais il s'endort après un moment sans visite (premier chargement lent).
- **Fly.io** ou **Railway** : quelques euros par mois, toujours allumés.
- Un petit serveur à la maison (mini-PC, NAS) avec un tunnel type Cloudflare Tunnel.

En ligne, la page est servie en https : il faut que le serveur soit derrière https (l'hébergeur s'en charge) pour que la connexion devienne `wss://` automatiquement, ce que le code fait déjà.
