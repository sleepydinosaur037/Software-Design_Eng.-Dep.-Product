var questionCount = 0
const correctAnswers = []
const questionContainer = document.getElementById("question-container")
const letters = ["a","b","c","d"]

function createQuestion(text, answerChoices, correct) {
    questionCount += 1
    correctAnswers.push(correct)
    
    const newQuestion = document.createElement("div")
    questionContainer.appendChild(newQuestion)
    newQuestion.className = "question"
    const heading = document.createElement("h2")
    newQuestion.appendChild(heading)
    heading.textContent = "Question " + questionCount
    const questionText = document.createElement("p")
    newQuestion.appendChild(questionText)
    questionText.innerHTML = text
    for (var i = 0; i < answerChoices.length; i++) {
        const option = document.createElement("input")
        newQuestion.appendChild(option)
        option.type = "radio"
        option.name = "q" + questionCount
        option.value = letters[i]
        option.id = "q" + questionCount + "-" + letters[i]
        const label = document.createElement("label")
        newQuestion.appendChild(label)
        label.htmlFor = option.id
        label.textContent = letters[i].toUpperCase() + ". " + answerChoices[i]
        newQuestion.appendChild(document.createElement("br"))
    }
}

createQuestion("Which of the following fits in the blank?<br>This ___ example question.", ["is a", "are a", "is an", "are an"], "c")
createQuestion("What does 'present' mean in this context?<br>The kid was <em>present</em> at the party.", ["now", "here", "gift", "show"], "b")

const addStatus = document.getElementById("add-status")
const addQuestion = document.getElementById("add-question")
const questionText = document.getElementById("add-text")
addQuestion.onclick = function(e) {
    const answerChoices = []
    var correctAnswers = ""
    for (var i = 0; i < 4; i++) {
        const letter = letters[i]
        var option = document.getElementById("add-option-" + letter).value
        var correct = document.getElementById("add-" + letter + "-correct").checked
        answerChoices.push(option)
        if (correct) {
            correctAnswers += letter
        }
    }
    if (correctAnswers == "") {
        addStatus.textContent = "You can't have a question with no correct answers!"
    } else {
        addStatus.textContent = "Question added successfully."
        createQuestion(questionText.value,answerChoices,correctAnswers)
        questionText.value = ""
        for (var i = 0; i < 4; i++) {
            const letter = letters[i]
            document.getElementById("add-option-" + letter).value = ""
            document.getElementById("add-" + letter + "-correct").checked = false
        }
    }
}

const quizCheck = document.getElementById("quiz-check")
const quizResult = document.getElementById("quiz-result")
quizCheck.onclick = function(e) {
    var score = 0
    for (var q = 0; q < questionCount; q++) {
        var option = document.querySelector("input[name='q" + (q+1) + "']:checked")
        if (option) {
            if (correctAnswers[q].includes(option.value)) {
                score += 1
            }
        }
        quizResult.textContent = "You got " + score + "/" + questionCount + " questions correct."
    }
}