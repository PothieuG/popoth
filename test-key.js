import Anthropic from "@anthropic-ai/sdk";
import 'dotenv/config'; // Pour charger les variables d'environnement depuis un fichier .env

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error("Erreur : La variable d'environnement ANTHROPIC_API_KEY n'est pas configurée.");
    return;
  }

  const anthropic = new Anthropic({ apiKey: apiKey });

  try {
    console.log("Clé API détectée. Connexion à l'API...");
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307", // Tu peux changer le modèle ici
      max_tokens: 100,
      messages: [
        { "role": "user", "content": "Quelle est la capitale de la France?" }
      ]
    });

    console.log("Réponse de l'API reçue avec succès :");
    console.log(response.content[0].text);
    console.log("\nVotre clé API est bien configurée et fonctionne.");

  } catch (error) {
    console.error("Une erreur s'est produite lors de l'appel API :", error.message);
    if (error.message.includes("invalid_api_key")) {
      console.error("L'erreur indique que votre clé API est invalide. Vérifiez qu'elle est correcte.");
    } else {
      console.error("L'erreur est probablement due à un autre problème (solde insuffisant, etc.).");
    }
  }
}

main();