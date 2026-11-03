
import { db, auth} from "../js/firebaseConfig.js";
import { doc, setDoc } from "firebase/firestore";



const addTagsButton = document.getElementById("addTagsButton");
const tagsContainer = document.getElementById("postTags");


const addImagesButton = document.getElementById("addImagesButton");
const imagesContainer = document.getElementById("postImage");
const fileInput = document.getElementById("fileInput");

addImagesButton.addEventListener("click", function(e){
  e.preventDefault();
  console.log("Clicked")
  fileInput.click();
});