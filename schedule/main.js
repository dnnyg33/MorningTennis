function updateTable(sortedObject) {
    console.log(sortedObject)
    // var table = document.querySelector("table")
    // let thead = table.createTHead();
    var table = document.getElementById("table")
    table.classList.add("flex-container")

    createDay2(sortedObject.Monday, "Monday", table)
    createDay2(sortedObject.Tuesday, "Tuesday", table)
    createDay2(sortedObject.Wednesday, "Wednesday", table)
    createDay2(sortedObject.Thursday, "Thursday", table)
    createDay2(sortedObject.Friday, "Friday", table)

    var playerCountLabel = document.getElementById("playerCount")
    playerCountLabel.innerHTML = sortedObject.playerCount + " players scheduled so far."
}

function createDay2(list, day, table) {

    var dayDiv = document.createElement("div")
    dayDiv.classList.add("day")
    dayDiv.innerHTML = day
    table.appendChild(dayDiv)
    var counter = 0
    if (list != undefined) {
        list.forEach(item => {
            counter++
            let div = document.createElement("div")
            if (counter <= 4) {
                div.classList.add("player")
            } else {
                div.classList.add("alternate")
            }
            div.classList.add("tooltip")
            let tooltipSpan = document.createElement("span")
            tooltipSpan.classList.add("tooltiptext")
            tooltipSpan.innerHTML = item.phoneNumber
            div.appendChild(tooltipSpan)
            let text = document.createTextNode(parseName(item.name))
            div.appendChild(text)
            dayDiv.appendChild(div)
        })
    }
}

function parseName(item) {
    let parts = item.split(" ")
    if (parts.length == 2) {
        return item
    } else {
        return parts[0] + " " + parts[1].substring(0, 1) + " " + parts[2]
    }
}

function createDay(list, day, table) {
    let row = table.insertRow()
    let header = document.createElement("td")
    header.classList.add("day")
    let headerText = document.createTextNode(day)
    header.appendChild(headerText)
    row.appendChild(header)
    console.log(list)
    var counter = 0
    if (list != undefined) {
        list.forEach(item => {
            counter++
            let th = document.createElement("td");
            if (counter <= 4) {
                th.classList.add("player")
            } else {
                th.classList.add("alternate")
            }
            let text = document.createTextNode(item);
            th.appendChild(text);
            row.appendChild(th);
        })
    }
}

function updateHeader(date) {
    // if (date == undefined) {
    //     document.getElementById("header").innerHTML = "Pick a date to see the schedule"
    //     instance = new dtsel.DTS('input[name="dateTimePicker"]', {
    //         showDate: true,
    //         showTime: false,
    //         dateFormat: "dddd-mm-dd-yyyy"
    //     });

    // } else {
    document.getElementById("header").innerHTML = "Morning Tennis Schedule for week starting " + date
    // }

}

function loadSchedule(date, loadEl, firebase) {
    var query = firebase.database().ref("/sorted/" + date)
    query.once('value').then(function (snapshot) {
        updateTable(snapshot.val())
        loadEl.style.display = "none";

        updateHeader(date)
    })
}

function parseDate(mondayName) {
    let str = mondayName.substring(7)
    return new Date(str)
}


// Checks that the Firebase SDK has been correctly setup and configured.
function checkSetup() {
    if (!window.firebase || !(firebase.app instanceof Function) || !firebase.app().options) {
        window.alert('You have not configured and imported the Firebase SDK. ' +
            'Make sure you go through the codelab setup instructions and make ' +
            'sure you are running the codelab using `firebase serve`');
    }
}

// Checks that Firebase has been imported.
//   checkSetup();

// We load currently existing chat messages and listen to new ones.
// loadSchedule();

function test() {
    var output = ""
    for (let i = str.length - 1; i <= 0; i--) {
        output += str[i]
    }
    return output;
}