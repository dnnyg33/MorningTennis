let data = [{
    "fifthChoice": "",
    "firstChoice": "Wednesday",
    "fourthChoice": "",
    "name": "Daniel",
    "secondChoice": "",
    "thirdChoice": "",
    "timestamp": "2021-01-17T16:30:46.110Z"
}, {
    "fifthChoice": "",
    "firstChoice": "Tuesday",
    "fourthChoice": "",
    "name": "Jon Anderson",
    "secondChoice": "Thursday",
    "thirdChoice": "",
    "timestamp": "2021-01-17T16:30:58.967Z"
}, {
    "fifthChoice": "Wednesday",
    "firstChoice": "Monday",
    "fourthChoice": "Tuesday",
    "name": "Terry",
    "secondChoice": "Friday",
    "thirdChoice": "Thursday",
    "timestamp": "2021-01-17T16:44:28.239Z"
}, {
    "fifthChoice": "",
    "firstChoice": "Wednesday",
    "fourthChoice": "",
    "name": "Vince",
    "secondChoice": "",
    "thirdChoice": "",
    "timestamp": "2021-01-17T16:48:08.557Z"
}, {
    "fifthChoice": "",
    "firstChoice": "Wednesday",
    "fourthChoice": "",
    "name": "Brock",
    "secondChoice": "",
    "thirdChoice": "",
    "timestamp": "2021-01-18T02:14:13.798Z"
}, {
    "fifthChoice": "",
    "firstChoice": "Tuesday",
    "fourthChoice": "",
    "name": "Merlin",
    "secondChoice": "Thursday",
    "thirdChoice": "",
    "timestamp": "2021-01-18T02:19:23.230Z"
}, {
    "fifthChoice": "",
    "firstChoice": "Wednesday",
    "fourthChoice": "",
    "name": "Jeff",
    "secondChoice": "Friday",
    "thirdChoice": "",
    "timestamp": "2021-01-18T02:19:53.972Z"
}, {
    "fifthChoice": "",
    "firstChoice": "Tuesday",
    "fourthChoice": "",
    "name": "Steve C",
    "secondChoice": "Thursday",
    "thirdChoice": "",
    "timestamp": "2021-01-18T02:20:13.072Z"
}, {
    "fifthChoice": "",
    "firstChoice": "Tuesday",
    "fourthChoice": "",
    "name": "Nate",
    "secondChoice": "Thursday",
    "thirdChoice": "",
    "timestamp": "2021-01-18T02:20:27.186Z"
}, {
    "fifthChoice": "",
    "firstChoice": "Wednesday",
    "fourthChoice": "",
    "name": "Yoshi",
    "secondChoice": "Monday",
    "thirdChoice": "Friday",
    "timestamp": "2021-01-18T02:21:24.227Z"
}, {
    "fifthChoice": "",
    "firstChoice": "Thursday",
    "fourthChoice": "",
    "name": "Sterling",
    "secondChoice": "Tuesday",
    "thirdChoice": "",
    "timestamp": "2021-01-18T02:21:35.411Z"
}, {
    "fifthChoice": "Friday",
    "firstChoice": "Monday",
    "fourthChoice": "Thursday",
    "name": "Les",
    "secondChoice": "Tuesday",
    "thirdChoice": "Wednesday",
    "timestamp": "2021-01-18T02:21:46.806Z"
}, {
    "fifthChoice": "",
    "firstChoice": "Friday",
    "fourthChoice": "",
    "name": "Greg",
    "secondChoice": "",
    "thirdChoice": "",
    "timestamp": "2021-01-18T02:21:54.304Z"
}]
var functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp(functions.config().firebase);

let monday = []
let tuesday = []
let wednesday = []
let thursday = []
let friday = []

function tennisSort(data) {
    let sorted1 = []
    let sorted2 = []
    let sorted3 = []
    let sorted4 = []
    let sorted5 = []
    data.forEach(item => {
        sorted1.push({"day": item.firstChoice, "name": item.name });
        sorted2.unshift({"day": item.secondChoice, "name": item.name })
        sorted3.push({"day": item.thirdChoice, "name": item.name })
        sorted4.unshift({"day": item.fourthChoice, "name": item.name })
        sorted5.push({"day": item.fifthChoice, "name": item.name })
    }
    );

    let sortedList = [].concat(sorted1, sorted2, sorted3, sorted4, sorted5)

    sortedList.forEach( pair => {

        if (pair.day == "Monday") {
            monday.push(pair.name)
        } else if (pair.day == "Tuesday") {
            tuesday.push(pair.name)
        }else if (pair.day == "Wednesday") {
            wednesday.push(pair.name)
        } else if (pair.day == "Thursday") {
            thursday.push(pair.name)
        } else if (pair.day == "Friday") {
            friday.push(pair.name)
        } else {
            //skip
        }
    })

    
    console.log("Monday")
    monday.forEach(element => {
        console.log(element)
    });
    console.log("Tue")
    tuesday.forEach(element => {
        console.log(element)
    });
    console.log("Wed")
    wednesday.forEach(element => {
        console.log(element)
    });
    console.log("Th")
    thursday.forEach(element => {
        console.log(element)
    });
    console.log("Fri")
    friday.forEach(element => {
        console.log(element)
    });

}
tennisSort()

admin.database().ref()