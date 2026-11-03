
import { db, auth} from "../js/firebaseConfig.js";
import { collection, doc, getDoc, setDoc } from "firebase/firestore";
import { getAuth, onAuthStateChanged } from "firebase/auth";





const addTagsButton = document.getElementById("addTagsButton");
const tagsContainer = document.getElementById("postTags");


const addImagesButton = document.getElementById("addImagesButton");
const imagesContainer = document.getElementById("postImage");
const fileInput = document.getElementById("fileInput");

const createPostButton = document.getElementById("createPostButton")

addImagesButton.addEventListener("click", function(e){
  e.preventDefault();
  console.log("Clicked")
  fileInput.click();
});

async function addPostToUserCollection(user) {
  try{
    const userId = user.uid
    const postRef = doc(collection(db,"users",userId,"createdPosts"))
    
    //placeholder data
    await setDoc(postRef,{
      title: "placeholder",
      desctiption: "placeholder",
      tags: [],
      images: []
    })



  } catch (error){
    console.log(error)
  }
};

createPostButton.addEventListener("click",function(e){
  e.preventDefault()
  const user = auth.currentUser
  addPostToUserCollection(user)


})