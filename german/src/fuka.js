/**
 * Master Fuka — the app's guide.
 *
 * He only ever produces a short line of text for a given situation. Keeping him
 * in one module means his tone can be changed (or he can be switched off)
 * without touching any screen.
 */

const LINES = {
  home: [
    'Let’s learn some German today!',
    'Pick a topic circle and we’ll start.',
    'A few words a day is better than a hundred once a month.',
  ],
  homeStarted: [
    'Good to see you again. Shall we carry on?',
    'Your words are waiting — pick up where you left off.',
  ],
  category: [
    'Choose a part of this topic.',
    'Small steps. One sub-topic at a time.',
  ],
  subcategory: [
    'Which kind of word would you like to work on?',
    'Nouns first? Remember: always learn the article with the word.',
  ],
  listNouns: [
    'Try to remember the article as well — der, die or das.',
    'Say the article out loud with every noun.',
  ],
  list: [
    'Read the German first, then check the meaning.',
    'Cover the meaning and test yourself before you reveal it.',
  ],
  practiceStart: [
    'Let’s practise! I picked the words you need most.',
    'Ready? Answer first, then check.',
  ],
  correct: ['Correct!', 'Well done!', 'That’s it!', 'Good job!'],
  wrong: ['Not quite — have a look at the card.', 'Almost. Keep this one for practice.'],
  practiceGood: ['Excellent work today!', 'Great round — those words are sticking.'],
  practiceMixed: ['Good effort. These words need more practice.', 'Nearly there — one more round?'],
  practiceEmpty: ['Nothing to practise here yet. Mark a few words first!'],
  search: ['Looking for a word? Type German or English.'],
  allLearned: ['Everything here is learned. Fantastic!'],
};

let lastLine = '';

/** A short line for a situation; avoids repeating the previous line. */
export function fukaSays(situation) {
  const lines = LINES[situation] || LINES.home;
  const options = lines.length > 1 ? lines.filter((l) => l !== lastLine) : lines;
  lastLine = options[Math.floor(Math.random() * options.length)];
  return lastLine;
}

/** The speech-bubble element used across the app. */
export function fukaBubble(situation, overrideText) {
  const text = overrideText || fukaSays(situation);
  return `
    <div class="fuka">
      <img class="fuka__avatar" src="./assets/master-fuka.jpg" alt="Master Fuka" width="72" height="72">
      <div class="fuka__bubble">
        <span class="fuka__name">Master Fuka</span>
        <p class="fuka__text">${text}</p>
      </div>
    </div>`;
}
